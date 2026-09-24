import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Property } from "@/lib/types";
const mocks = vi.hoisted(() => ({
  rows: new Map<string, { encrypted_password: string; configured: boolean }>(),
  attempts: new Set<string>(),
  station: vi.fn(),
  operation: vi.fn(),
}));
vi.mock("@/lib/server/db", () => ({
  db: () => ({
    from: (table: string) => ({
      upsert: async (row: {
        property_id: string;
        encrypted_password: string;
      }) => {
        if (!mocks.rows.has(row.property_id))
          mocks.rows.set(row.property_id, {
            encrypted_password: row.encrypted_password,
            configured: false,
          });
        return { data: null, error: null };
      },
      select: () => ({
        eq: (_key: string, id: string) => ({
          maybeSingle: async () => ({
            data:
              table === "squid_operations"
                ? mocks.attempts.has(id)
                  ? { key: id }
                  : null
                : mocks.rows.get(id) || null,
            error: null,
          }),
        }),
      }),
      update: (value: { configured: boolean }) => ({
        eq: async (_key: string, id: string) => {
          Object.assign(mocks.rows.get(id)!, value);
          return { data: null, error: null };
        },
      }),
    }),
  }),
  checked: (r: { data: unknown; error: unknown }) => {
    if (r.error) throw new Error("Storage failed");
    return r.data;
  },
  user: async () => null,
}));
vi.mock("@/lib/server/ivora", () => ({
  getStation: mocks.station,
  operation: mocks.operation,
}));
import {
  chargerCredentials,
  configureCredentials,
  decryptPassword,
  encryptPassword,
  newChargerPassword,
  seedCredentials,
} from "@/lib/server/charger-credentials";
const property = {
  id: "20000000-0000-4000-8000-000000000001",
  station_id: 43,
} as Property;
beforeEach(() => {
  vi.stubEnv("OCPP_CREDENTIAL_KEY", "ab".repeat(32));
  mocks.rows.clear();
  mocks.attempts.clear();
  vi.clearAllMocks();
  mocks.station.mockResolvedValue({ online: false });
  mocks.operation.mockResolvedValue({ status: "succeeded" });
});
afterEach(() => vi.unstubAllEnvs());
describe("preset charger credentials", () => {
  it("uses the API's minimum password length and avoids ambiguous characters", () => {
    const passwords = new Set(Array.from({ length: 50 }, newChargerPassword));
    expect(passwords.size).toBe(50);
    for (const password of passwords)
      expect(password).toMatch(/^[A-HJ-NP-Z2-9]{16}$/);
  });
  it("encrypts each password for its property and detects tampering", () => {
    const password = newChargerPassword(),
      ciphertext = encryptPassword(password, property.id);
    expect(ciphertext).not.toContain(password);
    expect(decryptPassword(ciphertext, property.id)).toBe(password);
    expect(() => decryptPassword(ciphertext, "another-property")).toThrow();
    expect(() =>
      decryptPassword(
        `${ciphertext[0] === "A" ? "B" : "A"}${ciphertext.slice(1)}`,
        property.id,
      ),
    ).toThrow();
  });
  it("persists a single password across retries and reveals it only after confirmation", async () => {
    await seedCredentials(property.id);
    const original = mocks.rows.get(property.id)!.encrypted_password;
    await seedCredentials(property.id);
    expect(mocks.rows.get(property.id)!.encrypted_password).toBe(original);
    expect(await chargerCredentials(property.id)).toEqual({
      password: null,
      pending: true,
    });
    await configureCredentials(property);
    expect(await chargerCredentials(property.id)).toEqual({
      password: decryptPassword(original, property.id),
      pending: false,
    });
    await configureCredentials(property);
    expect(mocks.operation).toHaveBeenCalledTimes(1);
  });
  it("recovers a previously dispatched credential update even if the charger is now online", async () => {
    await seedCredentials(property.id);
    mocks.attempts.add(`${property.id}:preset-credentials`);
    mocks.station.mockResolvedValue({ online: true });
    await configureCredentials(property);
    expect(mocks.operation).toHaveBeenCalledWith(
      `${property.id}:preset-credentials`,
      "stations/43/credentials",
      { password: expect.any(String) },
      "PUT",
    );
    expect((await chargerCredentials(property.id)).password).toHaveLength(16);
  });
  it("does not change existing or online charger credentials incidentally", async () => {
    await configureCredentials(property);
    expect(mocks.operation).not.toHaveBeenCalled();
    await seedCredentials(property.id);
    mocks.station.mockResolvedValue({ online: true });
    await expect(configureCredentials(property)).rejects.toThrow(/Disconnect/);
    expect(mocks.operation).not.toHaveBeenCalled();
  });
});
