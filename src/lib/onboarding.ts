export type AddressSelection = { label: string; token: string };
export type AddressSuggestion = { id: string; label: string };

export function stationIdentity(name: string, id: string) {
  const readable = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 16)
    .replace(/-$/, "");
  return `${readable || "squid"}-${id.replaceAll("-", "").slice(0, 6)}`;
}

// Ivora's rules for a per-project charger ID: letters, digits, underscores and
// hyphens, starting with a letter or digit, and at most 36 characters together
// with the p<project id>- prefix Ivora keeps for it internally.
const CHARGER_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
export const CHARGER_ID_NAME_LIMIT = 36;
export function chargerIdProblem(chargerId: string, projectId: string) {
  if (!CHARGER_ID.test(chargerId))
    return "A charger ID uses letters, numbers, hyphens and underscores, and starts with a letter or number.";
  const limit = CHARGER_ID_NAME_LIMIT - `p${projectId}-`.length;
  if (chargerId.length > limit)
    return `A charger ID can be at most ${limit} characters.`;
  return null;
}

export const demoAddresses = [
  {
    id: "forest",
    address: "12 Forest Lane",
    city: "Asheville",
    state: "NC",
    latitude: 35.5951,
    longitude: -82.5515,
    time_zone: "America/New_York",
  },
  {
    id: "pine",
    address: "24 Pine Ridge Road",
    city: "Asheville",
    state: "NC",
    latitude: 35.5951,
    longitude: -82.5515,
    time_zone: "America/New_York",
  },
  {
    id: "ocean",
    address: "18 Ocean Avenue",
    city: "San Diego",
    state: "CA",
    latitude: 32.7157,
    longitude: -117.1611,
    time_zone: "America/Los_Angeles",
  },
].map((address) => ({
  ...address,
  label: `${address.address}, ${address.city}, ${address.state}`,
}));
