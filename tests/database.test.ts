import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
const a = "10000000-0000-4000-8000-000000000001",
  b = "10000000-0000-4000-8000-000000000002";
const property = "20000000-0000-4000-8000-000000000001";
let pg: PGlite;
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(
    `create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`,
  );
  for (const file of (await readdir("supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await pg.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  }
  await pg.query("insert into auth.users(id) values($1),($2)", [a, b]);
  await pg.query(
    `insert into squid_properties(id,host_id,name,address,city,state,latitude,longitude,station_name,rate_cents) values($1,$2,'Private cabin','1 Main St','Asheville','NC',35,-82,'sq-private',35)`,
    [property, a],
  );
}, 20000);
afterAll(async () => {
  await pg?.close();
});
describe("Supabase migration and row-level isolation", () => {
  it("only lets a host read their own property", async () => {
    await pg.exec("set role authenticated");
    try {
      await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [
        a,
      ]);
      expect(
        (await pg.query("select id from squid_properties")).rows,
      ).toHaveLength(1);
      await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [
        b,
      ]);
      expect(
        (await pg.query("select id from squid_properties")).rows,
      ).toHaveLength(0);
    } finally {
      await pg.exec("reset role");
    }
  });
  it("denies public inventory and direct host writes", async () => {
    await pg.exec("set role anon");
    try {
      await expect(pg.query("select * from squid_properties")).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await pg.exec("reset role");
    }
    await pg.exec("set role authenticated");
    try {
      await expect(
        pg.query("update squid_properties set rate_cents=1"),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await pg.exec("reset role");
    }
  });
  it("keeps provider references and durable operations private", async () => {
    await pg.exec("set role authenticated");
    try {
      await expect(
        pg.query("select stripe_payment_id from squid_sessions"),
      ).rejects.toThrow(/permission denied/);
      await expect(pg.query("select * from squid_operations")).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        pg.query("select * from squid_charger_credentials"),
      ).rejects.toThrow(/permission denied/);
      await expect(
        pg.query("select squid_claim_lock('x',gen_random_uuid())"),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await pg.exec("reset role");
    }
  });
  it("serializes reconciliation across serverless workers", async () => {
    await pg.exec("set role service_role");
    try {
      const first = await pg.query<{ claimed: boolean }>(
        "select squid_claim_lock($1,$2) as claimed",
        ["test-session", a],
      );
      const second = await pg.query<{ claimed: boolean }>(
        "select squid_claim_lock($1,$2) as claimed",
        ["test-session", b],
      );
      expect(first.rows[0].claimed).toBe(true);
      expect(second.rows[0].claimed).toBe(false);
      await pg.query("delete from squid_locks where key=$1 and owner=$2", [
        "test-session",
        b,
      ]);
      expect((await pg.query("select * from squid_locks")).rows).toHaveLength(
        1,
      );
    } finally {
      await pg.exec("reset role");
    }
  });
  it("prevents two open sessions on a single charger", async () => {
    const query = `insert into squid_sessions(request_id,property_id,host_id,stripe_account_id,rate_cents,hold_cents,tariff_id) values(gen_random_uuid(),$1,$2,'acct_test',35,2500,1)`;
    await pg.query(query, [property, a]);
    await expect(pg.query(query, [property, a])).rejects.toThrow(
      /squid_one_active_session/,
    );
  });
  it("shares email quotas across workers and resets an expired window", async () => {
    await pg.exec("set role service_role");
    try {
      const take = () =>
        pg.query<{ allowed: boolean }>(
          "select squid_take_rate_limit('hashed-test-email',1,60) as allowed",
        );
      const attempts = await Promise.all([take(), take(), take()]);
      expect(attempts.filter((r) => r.rows[0].allowed)).toHaveLength(1);
      await pg.exec(
        "update squid_rate_limits set resets_at=now()-interval '1 second'",
      );
      expect((await take()).rows[0].allowed).toBe(true);
    } finally {
      await pg.exec("reset role");
    }
  });
  it("does not expose or let browsers reset email throttles", async () => {
    for (const role of ["anon", "authenticated"]) {
      await pg.exec(`set role ${role}`);
      try {
        await expect(
          pg.query("select * from squid_rate_limits"),
        ).rejects.toThrow(/permission denied/);
        await expect(
          pg.query("select squid_take_rate_limit('email',100,1)"),
        ).rejects.toThrow(/permission denied/);
      } finally {
        await pg.exec("reset role");
      }
    }
  });
});
