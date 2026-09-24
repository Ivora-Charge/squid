import postgres from "postgres";
import { readFile, readdir } from "node:fs/promises";
if (!process.env.SUPABASE_DB_URL) {
  console.error(
    "Add SUPABASE_DB_URL to .env, or run the SQL files in supabase/migrations in filename order in the Supabase SQL editor.",
  );
  process.exit(1);
}
const sql = postgres(process.env.SUPABASE_DB_URL, {
  ssl: "require",
  max: 1,
  connect_timeout: 15,
});
try {
  const directory = new URL("../supabase/migrations/", import.meta.url);
  const files = (await readdir(directory))
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();
  const applied = await sql.begin(async (transaction) => {
    await transaction`select pg_advisory_xact_lock(hashtext('squid:migrations'))`;
    await transaction.unsafe(
      `create table if not exists public.squid_schema_migrations (filename text primary key, applied_at timestamptz not null default now()); alter table public.squid_schema_migrations enable row level security; revoke all on public.squid_schema_migrations from public,anon,authenticated; grant select on public.squid_schema_migrations to service_role;`,
    );
    const recorded =
      await transaction`select filename from public.squid_schema_migrations`;
    const known = new Set(recorded.map((row) => row.filename));
    // Adopt the initial schema installed by the first version of this command
    // or through the SQL editor, without replaying its existing RLS policies.
    if (!known.has("202609230001_squid.sql")) {
      const tables =
        await transaction`select count(*)::integer as count from information_schema.tables where table_schema='public' and table_name in ('squid_hosts','squid_properties','squid_sessions','squid_operations','squid_locks')`;
      if (tables[0].count === 5) {
        await transaction`insert into public.squid_schema_migrations(filename) values('202609230001_squid.sql')`;
        known.add("202609230001_squid.sql");
      } else if (tables[0].count > 0)
        throw new Error("Incomplete Squid schema");
    }
    const changed = [];
    for (const filename of files) {
      if (known.has(filename)) continue;
      const source = await readFile(new URL(filename, directory), "utf8");
      // The complete set runs in this one transaction, including its ledger.
      await transaction.unsafe(
        source.replace(/^\s*begin;\s*/i, "").replace(/\s*commit;\s*$/i, ""),
      );
      await transaction`insert into public.squid_schema_migrations(filename) values(${filename})`;
      changed.push(filename);
    }
    return changed;
  });
  console.log(
    applied.length
      ? `Squid migrations applied: ${applied.join(", ")}`
      : "Squid schema is current. No changes applied.",
  );
} catch (error) {
  console.error("Migration failed:", error.code ?? "connection error");
  process.exitCode = 1;
} finally {
  await sql.end();
}
