import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";

const RATE_MIGRATION = "202610190001_host_fee_rate.sql";
const DATE_MIGRATION = "202610200001_host_fee_effective_date.sql";
const connected = "10000000-0000-4000-8000-000000000001",
  unconnected = "10000000-0000-4000-8000-000000000002",
  boundary = "10000000-0000-4000-8000-000000000003",
  after = "10000000-0000-4000-8000-000000000004",
  property = "20000000-0000-4000-8000-000000000001",
  session = "30000000-0000-4000-8000-000000000001";
// Account creation times around the default effective instant.
const BEFORE = "2026-10-31T23:59:59Z",
  AT = "2026-11-01T00:00:00Z",
  AFTER = "2026-11-03T12:00:00Z";
const migration = (file: string) =>
  readFile(`supabase/migrations/${file}`, "utf8");
async function migrations() {
  return (await readdir("supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort();
}
// A database with the schema as it was before the fee migrations.
async function legacyDatabase() {
  const pg = new PGlite();
  await pg.exec(
    `create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key,email text,created_at timestamptz default now(),email_confirmed_at timestamptz); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`,
  );
  for (const file of (await migrations()).filter((f) => f < RATE_MIGRATION))
    await pg.exec(await migration(file));
  return pg;
}
async function applyFrom(pg: PGlite, first: string) {
  for (const file of (await migrations()).filter((f) => f >= first))
    await pg.exec(await migration(file));
}
async function addUser(pg: PGlite, id: string, createdAt: string) {
  await pg.query(
    "insert into auth.users(id,email,created_at,email_confirmed_at) values($1,$2,$3,now())",
    [id, `${id.slice(-4)}@example.com`, createdAt],
  );
}
async function rate(pg: PGlite, table: string, id: string) {
  return (
    await pg.query<{ fee_basis_points: number }>(
      `select fee_basis_points from ${table} where id=$1`,
      [id],
    )
  ).rows[0]?.fee_basis_points;
}
// The upserts Squid runs when a host first connects Stripe: the current
// application always writes the rate, the earlier one relied on the default.
const payoutSetup = (pg: PGlite, id: string, fee?: number) =>
  fee === undefined
    ? pg.query(
        "insert into squid_hosts(id,stripe_account_id) values($1,$2) on conflict(id) do update set stripe_account_id=excluded.stripe_account_id",
        [id, `acct_${id.slice(-4)}`],
      )
    : pg.query(
        "insert into squid_hosts(id,stripe_account_id,fee_basis_points) values($1,$2,$3) on conflict(id) do update set stripe_account_id=excluded.stripe_account_id,fee_basis_points=excluded.fee_basis_points",
        [id, `acct_${id.slice(-4)}`, fee],
      );

describe("fee migrations applied before the effective date", () => {
  let pg: PGlite;
  beforeAll(async () => {
    pg = await legacyDatabase();
    await addUser(pg, connected, "2026-09-01T00:00:00Z");
    await addUser(pg, unconnected, BEFORE);
    await pg.query(
      "insert into squid_hosts(id,stripe_account_id) values($1,'acct_existing')",
      [connected],
    );
    await pg.query(
      `insert into squid_properties(id,host_id,name,address,city,state,latitude,longitude,station_name,rate_cents) values($1,$2,'Cabin','1 Main St','Asheville','NC',35,-82,'sq-cabin',35)`,
      [property, connected],
    );
    await pg.query(
      "insert into squid_sessions(id,request_id,property_id,host_id,stripe_account_id,status,rate_cents,hold_cents,tariff_id,total_cents,fee_cents) values($1,gen_random_uuid(),$2,$3,'acct_existing','completed',35,2500,1,1000,60)",
      [session, property, connected],
    );
    // Only accounts created before the effective date exist at this point.
    await applyFrom(pg, RATE_MIGRATION);
  }, 20000);
  afterAll(async () => {
    await pg?.close();
  });
  it("keeps every existing host at 6%", async () => {
    expect(await rate(pg, "squid_hosts", connected)).toBe(600);
    expect(await rate(pg, "squid_hosts", unconnected)).toBe(600);
    expect(
      (
        await pg.query(
          "select stripe_account_id from squid_hosts where id=$1",
          [unconnected],
        )
      ).rows[0],
    ).toEqual({ stripe_account_id: null });
  });
  it("backfills existing sessions at the 6% they were charged", async () => {
    expect(await rate(pg, "squid_sessions", session)).toBe(600);
  });
  it("never saves a host at 10% unless the application sets it", async () => {
    // A row saved without a rate takes the 6% default, so nobody pays 10%
    // before the effective date because a migration ran early.
    await payoutSetup(pg, unconnected);
    expect(await rate(pg, "squid_hosts", unconnected)).toBe(600);
    await addUser(pg, after, AFTER);
    await payoutSetup(pg, after, 1000);
    expect(await rate(pg, "squid_hosts", after)).toBe(1000);
  });
  it("is safe to apply twice", async () => {
    await pg.exec(await migration(RATE_MIGRATION));
    await pg.exec(await migration(DATE_MIGRATION));
    expect(await rate(pg, "squid_hosts", connected)).toBe(600);
    expect(await rate(pg, "squid_hosts", unconnected)).toBe(600);
    expect(await rate(pg, "squid_hosts", after)).toBe(1000);
    expect(await rate(pg, "squid_sessions", session)).toBe(600);
  });
  it("accepts only the 6% and 10% rates", async () => {
    await expect(
      pg.query("update squid_hosts set fee_basis_points=700 where id=$1", [
        connected,
      ]),
    ).rejects.toThrow(/check/);
    await expect(
      pg.query("update squid_sessions set fee_basis_points=null where id=$1", [
        session,
      ]),
    ).rejects.toThrow(/null/);
  });
  it("lets a host read their own rate but not change it", async () => {
    await pg.exec("set role authenticated");
    try {
      await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [
        connected,
      ]);
      expect(
        (await pg.query("select fee_basis_points from squid_hosts")).rows,
      ).toEqual([{ fee_basis_points: 600 }]);
      expect(
        (await pg.query("select fee_basis_points from squid_sessions")).rows,
      ).toEqual([{ fee_basis_points: 600 }]);
      await expect(
        pg.query("update squid_hosts set fee_basis_points=600"),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await pg.exec("reset role");
    }
  });
});

describe("fee migrations applied after the effective date", () => {
  let pg: PGlite;
  beforeAll(async () => {
    pg = await legacyDatabase();
    await addUser(pg, connected, BEFORE);
    await addUser(pg, boundary, AT);
    await addUser(pg, after, AFTER);
    await pg.query(
      "insert into squid_hosts(id,stripe_account_id) values($1,'acct_a'),($2,'acct_b')",
      [connected, after],
    );
    await applyFrom(pg, RATE_MIGRATION);
  }, 20000);
  afterAll(async () => {
    await pg?.close();
  });
  it("sets each host's rate from when their account was created", async () => {
    expect(await rate(pg, "squid_hosts", connected)).toBe(600);
    expect(await rate(pg, "squid_hosts", boundary)).toBe(1000);
    expect(await rate(pg, "squid_hosts", after)).toBe(1000);
  });
  it("is safe to apply twice", async () => {
    await pg.exec(await migration(DATE_MIGRATION));
    expect(await rate(pg, "squid_hosts", connected)).toBe(600);
    expect(await rate(pg, "squid_hosts", boundary)).toBe(1000);
    expect(await rate(pg, "squid_hosts", after)).toBe(1000);
  });
});

describe("fee date migration on a database that already has per-host rates", () => {
  let pg: PGlite;
  beforeAll(async () => {
    pg = await legacyDatabase();
    await addUser(pg, connected, "2026-09-01T00:00:00Z");
    await pg.exec(await migration(RATE_MIGRATION));
    // Accounts created after the first fee migration but before the
    // effective date were saved at its 10% default.
    await addUser(pg, unconnected, "2026-10-19T12:00:00Z");
    await addUser(pg, after, AFTER);
    await payoutSetup(pg, unconnected);
    await payoutSetup(pg, after);
    expect(await rate(pg, "squid_hosts", unconnected)).toBe(1000);
    await applyFrom(pg, DATE_MIGRATION);
  }, 20000);
  afterAll(async () => {
    await pg?.close();
  });
  it("moves hosts created before the effective date back to 6%", async () => {
    expect(await rate(pg, "squid_hosts", connected)).toBe(600);
    expect(await rate(pg, "squid_hosts", unconnected)).toBe(600);
    expect(await rate(pg, "squid_hosts", after)).toBe(1000);
  });
});
