import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { checked, db } from "./db";
import { required } from "./config";
import { IvoraError, forget, operation, rejectionCode } from "./ivora";
import { HttpError } from "./security";
import type { Property } from "../types";

function key() {
  const value = required("OCPP_CREDENTIAL_KEY");
  if (!/^[a-f0-9]{64}$/i.test(value))
    throw new Error("Missing valid OCPP_CREDENTIAL_KEY.");
  return Buffer.from(value, "hex");
}
export function newChargerPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(randomBytes(16), (b) => alphabet[b % alphabet.length]).join(
    "",
  );
}
export function encryptPassword(password: string, propertyId: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), nonce);
  cipher.setAAD(Buffer.from(propertyId));
  const encrypted = Buffer.concat([
    cipher.update(password, "utf8"),
    cipher.final(),
  ]);
  return [nonce, cipher.getAuthTag(), encrypted]
    .map((v) => v.toString("base64url"))
    .join(".");
}
export function decryptPassword(value: string, propertyId: string) {
  const [nonce, tag, ciphertext] = value
    .split(".")
    .map((v) => Buffer.from(v, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key(), nonce);
  decipher.setAAD(Buffer.from(propertyId));
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}
export async function seedCredentials(id: string) {
  checked(
    await db()
      .from("squid_charger_credentials")
      .upsert(
        {
          property_id: id,
          encrypted_password: encryptPassword(newChargerPassword(), id),
        },
        { onConflict: "property_id", ignoreDuplicates: true },
      ),
  );
}
async function storedCredentials(id: string) {
  return checked(
    await db()
      .from("squid_charger_credentials")
      .select("encrypted_password,configured")
      .eq("property_id", id)
      .maybeSingle(),
  );
}
export async function chargerCredentials(id: string) {
  const saved = await storedCredentials(id);
  return {
    password: saved?.configured
      ? decryptPassword(saved.encrypted_password, id)
      : null,
    pending: Boolean(saved && !saved.configured),
  };
}
export async function configureCredentials(p: Property) {
  const saved = await storedCredentials(p.id);
  // Existing chargers keep their current password unless the host requests a preset.
  if (!saved || saved.configured) return;
  if (!p.station_id)
    throw new HttpError(
      409,
      "Finish registering the charger before preparing its password.",
    );
  // Ivora stores the password for an offline charger's next connection and
  // pushes it to a connected OCPP 2.0.1 charger; only a connected OCPP 1.6
  // charger is rejected, so no online pre-check is needed.
  const key = `${p.id}:preset-credentials`;
  let result;
  try {
    result = await operation(
      key,
      `stations/${p.station_id}/credentials`,
      { password: decryptPassword(saved.encrypted_password, p.id) },
      "PUT",
    );
  } catch (error) {
    if (error instanceof IvoraError && error.code === "station_online")
      throw disconnectFirst();
    throw error;
  }
  if (rejectionCode(result) === "station_online") {
    // A rejection never reached the charger; let the next attempt dispatch again.
    await forget(key);
    throw disconnectFirst();
  }
  if (result.status !== "succeeded")
    throw new HttpError(
      503,
      "Your connection password is being prepared. Refresh setup to check again.",
    );
  checked(
    await db()
      .from("squid_charger_credentials")
      .update({ configured: true })
      .eq("property_id", p.id),
  );
}
function disconnectFirst() {
  return new HttpError(
    409,
    "Disconnect your charger before preparing its connection password.",
  );
}
