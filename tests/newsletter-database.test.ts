import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";

const subscriber = "10000000-0000-4000-8000-000000000001",
  quiet = "10000000-0000-4000-8000-000000000002",
  unconfirmed = "10000000-0000-4000-8000-000000000003",
  admin = "10000000-0000-4000-8000-000000000004";
const wording = "Email me the weekly Squid host newsletter.";
let pg: PGlite;
function hash(title: string, body: string) {
  return createHash("sha256").update(`${title}\n${body}`, "utf8").digest("hex");
}
async function value<T>(sql: string, params: unknown[] = []) {
  return (await pg.query<{ value: T }>(sql, params)).rows[0]?.value;
}
async function draft(title = "Spring hosting tips", body = "Hello hosts.") {
  return value<string>(
    "insert into squid_newsletter_issues(title,body,created_by) values($1,$2,$3) returning id as value",
    [title, body, admin],
  );
}
async function tested(id: string) {
  await pg.query(
    "update squid_newsletter_issues set tested_hash=squid_newsletter_content_hash(title,body),test_sent_at=now() where id=$1",
    [id],
  );
}
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(
    `create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key,email text,created_at timestamptz default now(),email_confirmed_at timestamptz); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`,
  );
  for (const file of (await readdir("supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await pg.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  await pg.query(
    "insert into auth.users(id,email,email_confirmed_at) values($1,'Sub@Example.com',now()),($2,'quiet@example.com',now()),($3,'new@example.com',null),($4,'mingcan@ivoracharge.com',now())",
    [subscriber, quiet, unconfirmed, admin],
  );
}, 20000);
afterAll(async () => {
  await pg?.close();
});
beforeEach(async () => {
  await pg.exec(
    "delete from squid_newsletter_clicks; delete from squid_newsletter_deliveries; delete from squid_newsletter_issues; delete from squid_newsletter_suppressions; delete from squid_newsletter_consent_events; delete from squid_newsletter_consent;",
  );
});

describe("newsletter consent", () => {
  it("is off by default and records each change with a timestamp and wording", async () => {
    expect(
      await value("select squid_newsletter_overview()->'audience' as value"),
    ).toBe(0);
    await pg.query("select squid_newsletter_set_consent($1,true,$2)", [
      subscriber,
      wording,
    ]);
    // Repeating the same choice does not add another record.
    await pg.query("select squid_newsletter_set_consent($1,true,$2)", [
      subscriber,
      wording,
    ]);
    await pg.query("select squid_newsletter_set_consent($1,false,$2)", [
      subscriber,
      wording,
    ]);
    const events = (
      await pg.query<{
        email: string;
        action: string;
        source: string;
        wording: string;
        created_at: Date;
      }>(
        "select email,action,source,wording,created_at from squid_newsletter_consent_events where host_id=$1 order by created_at,action desc",
        [subscriber],
      )
    ).rows;
    expect(events.map((e) => e.action)).toEqual(["opt_in", "opt_out"]);
    expect(events[0]).toMatchObject({
      email: "sub@example.com",
      source: "settings",
      wording,
    });
    expect(events[0].created_at).toBeInstanceOf(Date);
    expect(
      await value(
        "select subscribed as value from squid_newsletter_consent where host_id=$1",
        [subscriber],
      ),
    ).toBe(false);
  });
  it("keeps newsletter tables and functions away from browser roles", async () => {
    for (const role of ["anon", "authenticated"]) {
      await pg.exec(`set role ${role}`);
      try {
        for (const table of [
          "squid_newsletter_consent",
          "squid_newsletter_consent_events",
          "squid_newsletter_suppressions",
          "squid_newsletter_issues",
          "squid_newsletter_deliveries",
          "squid_newsletter_clicks",
        ])
          await expect(pg.query(`select * from ${table}`)).rejects.toThrow(
            /permission denied/,
          );
        await expect(
          pg.query("select squid_newsletter_set_consent($1,true,'x')", [
            subscriber,
          ]),
        ).rejects.toThrow(/permission denied/);
        await expect(
          pg.query("select squid_newsletter_unsubscribe($1)", [subscriber]),
        ).rejects.toThrow(/permission denied/);
      } finally {
        await pg.exec("reset role");
      }
    }
  });
});

describe("newsletter approval gate", () => {
  it("cannot send a draft, or mark one approved without a recorded approval", async () => {
    const id = await draft();
    await expect(
      pg.query("select squid_newsletter_start_send($1,$2)", [admin, id]),
    ).rejects.toThrow(/Only an approved issue/);
    await expect(
      pg.query(
        "update squid_newsletter_issues set status='approved' where id=$1",
        [id],
      ),
    ).rejects.toThrow(/check constraint/);
    await expect(
      pg.query(
        "update squid_newsletter_issues set status='sending' where id=$1",
        [id],
      ),
    ).rejects.toThrow(/check constraint/);
  });
  it("requires the administrator, a test of this content, and the previewed hash", async () => {
    const id = await draft();
    const current = hash("Spring hosting tips", "Hello hosts.");
    await expect(
      pg.query("select squid_newsletter_approve($1,$2,$3)", [
        admin,
        id,
        current,
      ]),
    ).rejects.toThrow(/Send a test/);
    await tested(id);
    await expect(
      pg.query("select squid_newsletter_approve($1,$2,$3)", [
        subscriber,
        id,
        current,
      ]),
    ).rejects.toThrow(/Administrator access required/);
    await expect(
      pg.query("select squid_newsletter_approve($1,$2,$3)", [
        admin,
        id,
        hash("Spring hosting tips", "Different words."),
      ]),
    ).rejects.toThrow(/Send a test/);
    // Content changed after the test: the test no longer counts.
    await pg.query(
      "update squid_newsletter_issues set body='Edited after the test.' where id=$1",
      [id],
    );
    await expect(
      pg.query("select squid_newsletter_approve($1,$2,$3)", [
        admin,
        id,
        hash("Spring hosting tips", "Edited after the test."),
      ]),
    ).rejects.toThrow(/Send a test/);
    await tested(id);
    await pg.query("select squid_newsletter_approve($1,$2,$3)", [
      admin,
      id,
      hash("Spring hosting tips", "Edited after the test."),
    ]);
    expect(
      await value(
        "select status as value from squid_newsletter_issues where id=$1",
        [id],
      ),
    ).toBe("approved");
  });
  it("refuses to send approved content that changed afterwards", async () => {
    const id = await draft();
    await tested(id);
    await pg.query("select squid_newsletter_approve($1,$2,$3)", [
      admin,
      id,
      hash("Spring hosting tips", "Hello hosts."),
    ]);
    await pg.query(
      "update squid_newsletter_issues set body='Sneaky edit.' where id=$1",
      [id],
    );
    await expect(
      pg.query("select squid_newsletter_start_send($1,$2)", [admin, id]),
    ).rejects.toThrow(/Only an approved issue/);
    await expect(
      pg.query("select squid_newsletter_start_send($1,$2)", [subscriber, id]),
    ).rejects.toThrow(/Administrator access required/);
  });
  it("sends only to confirmed, opted-in, unsuppressed hosts", async () => {
    for (const host of [subscriber, quiet, unconfirmed])
      await pg.query("select squid_newsletter_set_consent($1,true,$2)", [
        host,
        wording,
      ]);
    await pg.query("select squid_newsletter_set_consent($1,false,$2)", [
      quiet,
      wording,
    ]);
    const id = await draft();
    await tested(id);
    await pg.query("select squid_newsletter_approve($1,$2,$3)", [
      admin,
      id,
      hash("Spring hosting tips", "Hello hosts."),
    ]);
    expect(
      await value("select squid_newsletter_start_send($1,$2) as value", [
        admin,
        id,
      ]),
    ).toBe(1);
    const pending = (
      await pg.query<{ email: string }>(
        "select * from squid_newsletter_pending($1,10)",
        [id],
      )
    ).rows;
    expect(pending.map((d) => d.email)).toEqual(["sub@example.com"]);
  });
});

describe("newsletter unsubscribe and suppression", () => {
  async function sending() {
    await pg.query("select squid_newsletter_set_consent($1,true,$2)", [
      subscriber,
      wording,
    ]);
    const id = await draft();
    await tested(id);
    await pg.query("select squid_newsletter_approve($1,$2,$3)", [
      admin,
      id,
      hash("Spring hosting tips", "Hello hosts."),
    ]);
    await pg.query("select squid_newsletter_start_send($1,$2)", [admin, id]);
    const delivery = await value<string>(
      "select id as value from squid_newsletter_deliveries where issue_id=$1",
      [id],
    );
    return { id, delivery };
  }
  it("suppresses the address, withdraws consent, and skips pending sends", async () => {
    const { id, delivery } = await sending();
    expect(
      await value("select squid_newsletter_unsubscribe($1) as value", [
        delivery,
      ]),
    ).toBe(true);
    // Repeated one-click requests are harmless.
    expect(
      await value("select squid_newsletter_unsubscribe($1) as value", [
        delivery,
      ]),
    ).toBe(true);
    expect(
      await value(
        "select reason as value from squid_newsletter_suppressions where email='sub@example.com'",
      ),
    ).toBe("unsubscribed");
    expect(
      (
        await pg.query(
          "select action,source from squid_newsletter_consent_events where host_id=$1 and action='opt_out'",
          [subscriber],
        )
      ).rows,
    ).toEqual([{ action: "opt_out", source: "unsubscribe" }]);
    expect(
      (await pg.query("select * from squid_newsletter_pending($1,10)", [id]))
        .rows,
    ).toEqual([]);
    expect(
      await value(
        "select status as value from squid_newsletter_deliveries where id=$1",
        [delivery],
      ),
    ).toBe("skipped");
    const overview = await value<{
      issues: { unsubscribed: number }[];
      audience: number;
    }>("select squid_newsletter_overview() as value");
    expect(overview?.audience).toBe(0);
    expect(overview?.issues[0].unsubscribed).toBe(1);
    expect(
      await value("select squid_newsletter_unsubscribe($1) as value", [
        "30000000-0000-4000-8000-000000000000",
      ]),
    ).toBe(false);
  });
  it("lets a host opt back in after unsubscribing, but keeps bounces suppressed", async () => {
    const { delivery } = await sending();
    await pg.query("select squid_newsletter_unsubscribe($1)", [delivery]);
    await pg.query("select squid_newsletter_set_consent($1,true,$2)", [
      subscriber,
      wording,
    ]);
    expect(
      await value(
        "select count(*)::int as value from squid_newsletter_suppressions",
      ),
    ).toBe(0);
    await pg.query(
      "update squid_newsletter_deliveries set status='sent',provider_id='email_1' where id=$1",
      [delivery],
    );
    await pg.query(
      "select squid_newsletter_bounce('email_1',array['SUB@example.com'],'bounced')",
    );
    expect(
      await value(
        "select status as value from squid_newsletter_deliveries where id=$1",
        [delivery],
      ),
    ).toBe("bounced");
    await pg.query("select squid_newsletter_set_consent($1,true,$2)", [
      subscriber,
      wording,
    ]);
    expect(
      await value(
        "select reason as value from squid_newsletter_suppressions where email='sub@example.com'",
      ),
    ).toBe("bounced");
    expect(
      await value("select squid_newsletter_overview()->'audience' as value"),
    ).toBe(0);
  });
});
