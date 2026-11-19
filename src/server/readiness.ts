import { authenticationConfig, emailOutboxConfig } from "./config.ts";
import { MIN_SCHEMA_VERSION, WEB_RUNTIME_GRANTS, type Database } from "./database.ts";

type Environment = Readonly<Record<string, string | undefined>>;

export async function assertDatabaseReady(database: Database) {
  await database.ready();
  const migration = await database.get("SELECT max(version) AS version FROM schema_migrations");
  const version = Number(migration?.version);
  if (!Number.isSafeInteger(version) || version < MIN_SCHEMA_VERSION) throw new Error("Database migrations are incomplete.");
}

export async function assertApplicationReady(database: Database, env: Environment = process.env) {
  const config = authenticationConfig(env);
  if (config.mode === "production") emailOutboxConfig(env);
  await assertDatabaseReady(database);
  const permissions = WEB_RUNTIME_GRANTS.flatMap(([privileges, tables]) =>
    tables.flatMap((table) => privileges.split(",").map((privilege) => ({ table: `public.${table}`, privilege }))));
  const scope = await database.get<{ permitted: boolean }>(`SELECT bool_and(has_table_privilege(current_user,required.relation,required.permission)) AS permitted
    FROM unnest($1::text[],$2::text[]) AS required(relation,permission)`,
  [permissions.map((item) => item.table), permissions.map((item) => item.privilege)]);
  if (scope?.permitted !== true) throw new Error("Web runtime database grants are incomplete.");
}
