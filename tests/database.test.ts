import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
const a = "10000000-0000-4000-8000-000000000001",
  b = "10000000-0000-4000-8000-000000000002",
  admin = "10000000-0000-4000-8000-000000000003";
const property = "20000000-0000-4000-8000-000000000001";
let pg: PGlite;
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(
    `create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key,email text,created_at timestamptz default now(),email_confirmed_at timestamptz); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`,
  );
  for (const file of (await readdir("supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await pg.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  }
  await pg.query(
    "insert into auth.users(id,email,email_confirmed_at) values($1,'host-a@example.com',now()),($2,'host-b@example.com',now()),($3,'mingcan@ivoracharge.com',now())",
    [a, b, admin],
  );
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
describe("price per kWh", () => {
  const premium = "20000000-0000-4000-8000-000000000002";
  const insert = (id: string, station: string, rate: number) =>
    pg.query(
      `insert into squid_properties(id,host_id,name,address,city,state,latitude,longitude,station_name,rate_cents) values($1,$2,'Premium cabin','2 Main St','Asheville','NC',35,-82,$3,$4)`,
      [id, a, station, rate],
    );
  it("has no ceiling but must stay positive", async () => {
    await pg.exec("reset role");
    await insert(premium, "sq-premium", 1250);
    expect(
      (
        await pg.query("select rate_cents from squid_properties where id=$1", [
          premium,
        ])
      ).rows,
    ).toEqual([{ rate_cents: 1250 }]);
    await expect(
      insert("20000000-0000-4000-8000-000000000003", "sq-free", 0),
    ).rejects.toThrow(/rate_cents_check/);
  });
});

describe("feedback and administrator database permissions", () => {
  const feedbackId = "30000000-0000-4000-8000-000000000001";
  const firstHash = "a".repeat(64);
  const secondHash = "b".repeat(64);
  async function service<T>(run: () => Promise<T>) {
    await pg.exec("set role service_role");
    try {
      return await run();
    } finally {
      await pg.exec("reset role");
    }
  }
  it("denies browser roles access to feedback, tenant leases, audit records, and admin functions", async () => {
    for (const role of ["anon", "authenticated"]) {
      await pg.exec(`set role ${role}`);
      try {
        for (const table of [
          "squid_feedback",
          "squid_tenant_access",
          "squid_admin_audit",
        ]) {
          await expect(pg.query(`select * from ${table}`)).rejects.toThrow(
            /permission denied/,
          );
        }
        for (const query of [
          "select squid_admin_summary()",
          "select squid_admin_tenants()",
          `select squid_start_tenant_access('${admin}','${a}','${firstHash}','Support')`,
          `select squid_end_tenant_access('${admin}',null)`,
          `select squid_admin_feedback_status('${admin}','${feedbackId}','resolved')`,
        ]) {
          await expect(pg.query(query)).rejects.toThrow(/permission denied/);
        }
      } finally {
        await pg.exec("reset role");
      }
    }
  });
  it("lists tenant counts with literal search, UUID lookup, and pagination", async () => {
    await service(async () => {
      const tenants = async (search: string, offset = 0, limit = 25) =>
        (
          await pg.query<{
            data: {
              total: number;
              tenants: { id: string; chargers: number; sessions: number }[];
            };
          }>("select squid_admin_tenants($1,$2,$3) as data", [
            search,
            offset,
            limit,
          ])
        ).rows[0].data;
      expect((await tenants("HOST-A")).tenants[0]).toMatchObject({
        id: a,
        chargers: 2,
        sessions: 1,
      });
      expect((await tenants("Asheville")).tenants.map((row) => row.id)).toEqual(
        [a],
      );
      expect((await tenants(b)).tenants.map((row) => row.id)).toEqual([b]);
      expect(await tenants("%")).toEqual({ total: 0, tenants: [] });
      const page = await tenants("", 1, 1);
      expect(page.total).toBe(3);
      expect(page.tenants).toHaveLength(1);
    });
  });
  it("requires the verified administrator in the database before starting tenant access", async () => {
    await service(async () => {
      await expect(
        pg.query("select squid_start_tenant_access($1,$2,$3,'Support')", [
          a,
          b,
          firstHash,
        ]),
      ).rejects.toThrow(/Administrator access required/);
      await expect(
        pg.query("select squid_start_tenant_access($1,$2,$3,'Support')", [
          admin,
          admin,
          firstHash,
        ]),
      ).rejects.toThrow(/Tenant not found/);
    });
    await pg.query(
      "update auth.users set email_confirmed_at=null where id=$1",
      [admin],
    );
    try {
      await service(async () => {
        await expect(
          pg.query("select squid_start_tenant_access($1,$2,$3,'Support')", [
            admin,
            a,
            firstHash,
          ]),
        ).rejects.toThrow(/Administrator access required/);
      });
    } finally {
      await pg.query(
        "update auth.users set email_confirmed_at=now() where id=$1",
        [admin],
      );
    }
  });
  it("atomically switches workspaces, keeps one active lease, and audits access", async () => {
    await service(async () => {
      await pg.query(
        "select squid_start_tenant_access($1,$2,$3,'Support case one')",
        [admin, a, firstHash],
      );
      await pg.query(
        "select squid_start_tenant_access($1,$2,$3,'Support case two')",
        [admin, b, secondHash],
      );
      const active = (
        await pg.query<{ tenant_id: string; token_hash: string; ttl: number }>(
          "select tenant_id,token_hash,extract(epoch from expires_at-created_at)::integer as ttl from squid_tenant_access where ended_at is null",
        )
      ).rows;
      expect(active).toEqual([
        { tenant_id: b, token_hash: secondHash, ttl: 3600 },
      ]);
      expect(
        (
          await pg.query(
            "select id from squid_tenant_access where ended_at is not null",
          )
        ).rows,
      ).toHaveLength(1);
      expect(
        (
          await pg.query<{ event: string }>(
            "select event from squid_admin_audit order by created_at,id",
          )
        ).rows
          .map((row) => row.event)
          .sort(),
      ).toEqual(["access_ended", "access_started", "access_started"]);
      // A failed new lease rolls back revocation of the existing workspace.
      await expect(
        pg.query(
          "select squid_start_tenant_access($1,$2,'invalid','Support')",
          [admin, a],
        ),
      ).rejects.toThrow(/check constraint/);
      expect(
        (
          await pg.query(
            "select tenant_id from squid_tenant_access where ended_at is null",
          )
        ).rows,
      ).toEqual([{ tenant_id: b }]);
      // Ending an old tab's lease cannot end the current tab's lease.
      await pg.query("select squid_end_tenant_access($1,$2)", [
        admin,
        firstHash,
      ]);
      expect(
        (
          await pg.query(
            "select id from squid_tenant_access where ended_at is null",
          )
        ).rows,
      ).toHaveLength(1);
      await pg.query("select squid_end_tenant_access($1,null)", [admin]);
      expect(
        (
          await pg.query(
            "select id from squid_tenant_access where ended_at is null",
          )
        ).rows,
      ).toHaveLength(0);
    });
  });
  it("only allows audited feedback status changes and keeps the audit append-only", async () => {
    await service(async () => {
      await pg.query(
        "insert into squid_feedback(id,category,message,page_path) values($1,'idea','More helpful setup','/')",
        [feedbackId],
      );
      await expect(
        pg.query("select squid_admin_feedback_status($1,$2,'resolved')", [
          a,
          feedbackId,
        ]),
      ).rejects.toThrow(/Administrator access required/);
      await pg.query("select squid_admin_feedback_status($1,$2,'reviewing')", [
        admin,
        feedbackId,
      ]);
      expect(
        (
          await pg.query(
            "select email,rating,status from squid_feedback where id=$1",
            [feedbackId],
          )
        ).rows,
      ).toEqual([{ email: null, rating: null, status: "reviewing" }]);
      expect(
        (
          await pg.query(
            "select actor_id,subject_id,event,reason from squid_admin_audit where subject_id=$1",
            [feedbackId],
          )
        ).rows,
      ).toEqual([
        {
          actor_id: admin,
          subject_id: feedbackId,
          event: "feedback_updated",
          reason: "reviewing",
        },
      ]);
      await expect(
        pg.query("select squid_admin_feedback_status($1,$2,'deleted')", [
          admin,
          feedbackId,
        ]),
      ).rejects.toThrow(/check constraint/);
      expect(
        (
          await pg.query(
            "select id from squid_admin_audit where subject_id=$1",
            [feedbackId],
          )
        ).rows,
      ).toHaveLength(1);
      await expect(
        pg.query("update squid_admin_audit set reason='tampered'"),
      ).rejects.toThrow(/permission denied/);
      await expect(pg.query("delete from squid_admin_audit")).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        pg.query(
          "update squid_tenant_access set expires_at=now()+interval '1 year'",
        ),
      ).rejects.toThrow(/permission denied/);
    });
  });
});
