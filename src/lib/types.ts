import type { ChargerStatus, GuestAvailability } from "./status";
export type Property = {
  id: string;
  host_id: string;
  name: string;
  slug: string;
  address: string;
  city: string;
  state: string;
  latitude: number;
  longitude: number;
  time_zone: string;
  instructions: string;
  connector_type: string;
  max_kw: number;
  rate_cents: number;
  hold_cents: number;
  station_name: string;
  station_id: number | null;
  connector_id: number | null;
  location_id: number | null;
  tariff_id: number | null;
  ocpp_url: string | null;
  published: boolean;
  created_at: string;
};
export type ChargeStatus =
  | "awaiting_payment"
  | "starting"
  | "charging"
  | "stopping"
  | "settling"
  | "completed"
  | "canceled"
  | "refunded"
  | "review";
export type ChargeSession = {
  id: string;
  request_id: string;
  property_id: string;
  host_id: string;
  stripe_account_id: string;
  status: ChargeStatus;
  rate_cents: number;
  hold_cents: number;
  tariff_id: number;
  stripe_checkout_id: string | null;
  stripe_payment_id: string | null;
  checkout_url: string | null;
  ivora_session_id: string | null;
  energy_kwh: number;
  total_cents: number | null;
  fee_cents: number | null;
  stop_requested: boolean;
  refund_requested: boolean;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  ended_at: string | null;
};
export type PublicSession = Pick<
  ChargeSession,
  | "id"
  | "property_id"
  | "status"
  | "rate_cents"
  | "hold_cents"
  | "checkout_url"
  | "energy_kwh"
  | "total_cents"
  | "created_at"
  | "started_at"
  | "ended_at"
  | "stop_requested"
>;
export type HostSession = Pick<
  ChargeSession,
  | "id"
  | "property_id"
  | "status"
  | "rate_cents"
  | "energy_kwh"
  | "total_cents"
  | "fee_cents"
  | "created_at"
  | "started_at"
  | "ended_at"
>;
export type DashboardData = {
  properties: Property[];
  sessions: HostSession[];
  email: string;
  payoutsReady: boolean;
  stripeConnected: boolean;
  status: Record<string, ChargerStatus>;
};
export type PublicProperty = Pick<
  Property,
  | "id"
  | "slug"
  | "name"
  | "city"
  | "state"
  | "instructions"
  | "connector_type"
  | "max_kw"
  | "rate_cents"
  | "hold_cents"
> & { availability: GuestAvailability; testMode: boolean };
