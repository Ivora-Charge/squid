import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { required } from "./config";
import { HttpError } from "./security";
import type { AddressSuggestion } from "../onboarding";

const resolvedAddress = z.object({
  address: z.string().min(3).max(120),
  city: z.string().min(1).max(120),
  state: z.string().regex(/^[A-Z]{2}$/),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  time_zone: z.string().refine((v) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: v });
      return true;
    } catch {
      return false;
    }
  }),
});
const selectionSchema = z.object({
  hostId: z.uuid(),
  expires: z.number(),
  address: resolvedAddress,
});
function signature(payload: string) {
  return createHmac("sha256", required("SUPABASE_SERVICE_ROLE_KEY"))
    .update(`squid-address:${payload}`)
    .digest("base64url");
}
export function signAddress(
  hostId: string,
  address: z.infer<typeof resolvedAddress>,
) {
  const payload = Buffer.from(
    JSON.stringify({
      hostId,
      address: resolvedAddress.parse(address),
      expires: Date.now() + 60 * 60 * 1000,
    }),
  ).toString("base64url");
  return `${payload}.${signature(payload)}`;
}
export function readAddress(token: string, hostId: string) {
  const [payload, supplied, extra] = token.split(".");
  const expected = signature(payload || "");
  if (
    !payload ||
    !supplied ||
    extra ||
    Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  )
    throw new HttpError(
      400,
      "Please choose your property address from the suggestions.",
    );
  let selection;
  try {
    selection = selectionSchema.parse(
      JSON.parse(Buffer.from(payload, "base64url").toString()),
    );
  } catch {
    throw new HttpError(400, "Please select your address again.");
  }
  if (selection.hostId !== hostId || selection.expires < Date.now())
    throw new HttpError(
      400,
      "Your address selection expired. Please select it again.",
    );
  return selection.address;
}
async function places(path: string, mask: string, body?: unknown) {
  const response = await fetch(`https://places.googleapis.com/v1/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": required("GOOGLE_MAPS_ADDRESS_API_KEY"),
      "X-Goog-FieldMask": mask,
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok)
    throw new HttpError(
      503,
      "Address search is temporarily unavailable. Please try again.",
    );
  return response.json();
}
export async function suggestAddresses(
  query: string,
  session: string,
): Promise<AddressSuggestion[]> {
  const result = await places(
    "places:autocomplete",
    "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text",
    {
      input: query,
      sessionToken: session,
      includedRegionCodes: ["us"],
      languageCode: "en",
    },
  );
  const data = z
    .object({
      suggestions: z
        .array(
          z.object({
            placePrediction: z
              .object({
                placeId: z.string(),
                text: z.object({ text: z.string() }),
              })
              .optional(),
          }),
        )
        .default([]),
    })
    .parse(result);
  return data.suggestions.flatMap(({ placePrediction: p }) =>
    p ? [{ id: p.placeId, label: p.text.text }] : [],
  );
}
export async function selectAddress(
  placeId: string,
  session: string,
  hostId: string,
) {
  const data = z
    .object({
      formattedAddress: z.string(),
      addressComponents: z.array(
        z.object({
          longText: z.string(),
          shortText: z.string().optional(),
          types: z.array(z.string()),
        }),
      ),
      location: z.object({ latitude: z.number(), longitude: z.number() }),
    })
    .parse(
      await places(
        `places/${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(session)}`,
        "formattedAddress,addressComponents,location",
      ),
    );
  const part = (type: string, short = false) => {
    const p = data.addressComponents.find((c) => c.types.includes(type));
    return (short ? p?.shortText : p?.longText) || "";
  };
  if (
    part("country", true) !== "US" ||
    !part("street_number") ||
    !part("route")
  )
    throw new HttpError(
      400,
      "Please select a complete United States street address.",
    );
  const url = new URL("https://maps.googleapis.com/maps/api/timezone/json");
  url.search = new URLSearchParams({
    location: `${data.location.latitude},${data.location.longitude}`,
    timestamp: String(Math.floor(Date.now() / 1000)),
    key: required("GOOGLE_MAPS_ADDRESS_API_KEY"),
  }).toString();
  const response = await fetch(url, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(8000),
  });
  const zone = z
    .object({ status: z.string(), timeZoneId: z.string().optional() })
    .parse(await response.json());
  if (!response.ok || zone.status !== "OK" || !zone.timeZoneId)
    throw new HttpError(
      503,
      "We couldn’t confirm that address. Please try again.",
    );
  const address = resolvedAddress.parse({
    address: `${part("street_number")} ${part("route")}`,
    city:
      part("locality") ||
      part("postal_town") ||
      part("sublocality_level_1") ||
      part("administrative_area_level_2"),
    state: part("administrative_area_level_1", true),
    ...data.location,
    time_zone: zone.timeZoneId,
  });
  return { label: data.formattedAddress, token: signAddress(hostId, address) };
}
