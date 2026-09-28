export type ChargerStatus = "online" | "offline" | "unknown";
export type GuestAvailability = "ready" | "offline" | "unavailable";
type StationLike = {
  online: boolean;
  connectors: { id: number; status?: string | null }[];
};
// What a host sees. A failed lookup is "unknown", never a false "offline".
export function chargerStatus(
  station: StationLike | null | undefined,
): ChargerStatus {
  if (!station) return "unknown";
  return station.online ? "online" : "offline";
}
// What a guest sees. A failed lookup fails closed: no payment is offered.
export function guestAvailability(
  station: StationLike | null | undefined,
  connectorId: number | null | undefined,
): GuestAvailability {
  if (!station?.online) return "offline";
  const connector = station.connectors.find((c) => c.id === connectorId);
  return connector &&
    ["Available", "Preparing"].includes(connector.status ?? "")
    ? "ready"
    : "unavailable";
}
