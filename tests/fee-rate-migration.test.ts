import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";

const MIGRATION = "202610190001_host_fee_rate.sql";
const connected = "10000000-0000-4000-8000-000000000001",
  unconnected = "10000000-0000-4000-8000-000000000002",
  later = "10000000-0000-4000-8000-000000000003",
  property = "20000000-0000-4000-8000-000000000001",
  session = "30000000-0000-4000-8000-000000000001";
let pg: PGlite;
async function rate(table: string, id: string) {
  return (
    await pg.query<{ fee_basis_points: number }>(
      `select fee_basis_points from ${table} where id=$1`,
      [id],
    )
  ).rows[0]?.fee_basis_points;
}
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(
    `create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key,email text,created_at timestamptz default now(),email_confirmed_at timestamptz); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`,
  );
  const files = (await readdir("supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  // Build the schema as it was before the fee migration, with existing data.
  for (const file of files.filter((f) => f < MIGRATION))
    await pg.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  await pg.query(
    "insert into auth.users(id,email,email_confirmed_at) values($1,'connected@example.com',now()),($2,'unconnected@example.com',now())",
    [connected, unconnected],
  );
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
  for (const file of files.filter((f) => f >= MIGRATION))
    await pg.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
}, 20000);
afterAll(async () => {
  await pg?.close();
});
describe("per-host Squid fee migration", () => {
  it("backfills every existing host at 6%", async () => {
    expect(await rate("squid_hosts", connected)).toBe(600);
  });
  it("keeps 6% for accounts that signed up before payout setup", async () => {
    expect(await rate("squid_hosts", unconnected)).toBe(600);
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
    expect(await rate("squid_sessions", session)).toBe(600);
  });
  it("creates new hosts at 10% and keeps the rate through payout setup", async () => {
    await pg.query(
      "insert into auth.users(id,email) values($1,'new@example.com')",
      [later],
    );
    // The same upsert Squid runs when a host first connects Stripe.
    await pg.query(
      "insert into squid_hosts(id,stripe_account_id) values($1,'acct_new') on conflict(id) do update set stripe_account_id=excluded.stripe_account_id",
      [later],
    );
    expect(await rate("squid_hosts", later)).toBe(1000);
    await pg.query(
      "insert into squid_hosts(id,stripe_account_id) values($1,'acct_existing_2') on conflict(id) do update set stripe_account_id=excluded.stripe_account_id",
      [unconnected],
    );
    expect(await rate("squid_hosts", unconnected)).toBe(600);
  });
  it("does not move newer hosts to 6% when applied again", async () => {
    const other = "10000000-0000-4000-8000-000000000004";
    await pg.query(
      "insert into auth.users(id,email) values($1,'other@example.com')",
      [other],
    );
    await pg.exec(await readFile(`supabase/migrations/${MIGRATION}`, "utf8"));
    expect(await rate("squid_hosts", later)).toBe(1000);
    expect(await rate("squid_hosts", other)).toBeUndefined();
    expect(await rate("squid_hosts", connected)).toBe(600);
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
