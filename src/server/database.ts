import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

export type DatabaseEnvironment = "synthetic-demo-only" | "production" | "test";
export const MIN_SCHEMA_VERSION = 6;
export const WEB_RUNTIME_GRANTS = [
  ["SELECT", ["app_metadata", "schema_migrations"]],
  ["SELECT,INSERT", ["users", "memberships", "audit_entries", "recipient_snapshots", "recipient_versions", "claim_events", "goal_history"]],
  ["SELECT,INSERT,UPDATE", ["wishlists", "goals", "contributions"]],
  ["SELECT,INSERT,UPDATE,DELETE", ["auth_users", "auth_sessions", "auth_accounts", "auth_verifications", "auth_rate_limits", "rate_limits", "auth_local_outbox", "auth_email_outbox", "auth_email_budgets"]]
] as const;

export function poolOptions(connectionString: string) {
  const url = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("PostgreSQL DATABASE_URL is required.");
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  for (const key of ["sslcert", "sslkey", "sslrootcert"]) {
    if (url.searchParams.has(key)) throw new Error("Custom TLS material in DATABASE_URL is not supported.");
  }
  const sslMode = url.searchParams.get("sslmode");
  if (!local && sslMode && !["require", "verify-full"].includes(sslMode)) throw new Error("Remote database TLS verification cannot be disabled.");
  url.searchParams.delete("sslmode");
  url.searchParams.delete("channel_binding");
  return {
    connectionString: url.toString(),
    ssl: local ? false as const : { rejectUnauthorized: true },
    enableChannelBinding: !local,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
    statement_timeout: 15000,
    application_name: "wedding-dream-wishlist"
  };
}

export class Database {
  readonly pool: Pool;
  private readonly client?: PoolClient;
  private readonly environments?: readonly DatabaseEnvironment[];
  private verification?: Promise<void>;
  constructor(pool: Pool, client?: PoolClient, environments?: readonly DatabaseEnvironment[]) {
    this.pool = pool; this.client = client; this.environments = environments;
  }

  async ready(): Promise<void> {
    if (!this.environments) return;
    this.verification ??= (async () => {
      const marker = await this.pool.query("SELECT value FROM app_metadata WHERE key='environment'");
      if (!this.environments?.includes(marker.rows[0]?.value)) throw new Error("Runtime database environment does not match.");
      const role = await this.pool.query(`SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls,
        has_schema_privilege(current_user,current_schema(),'CREATE') AS schema_create,
        EXISTS(SELECT 1 FROM pg_class WHERE relnamespace=current_schema()::regnamespace
          AND relkind IN ('r','p') AND pg_has_role(current_user,relowner,'MEMBER')) AS owns_tables
        FROM pg_roles WHERE rolname=current_user`);
      const permissions = role.rows[0];
      if (!permissions || Object.values(permissions).some(Boolean)) throw new Error("A restricted non-owning runtime database role is required.");
      const migration = await this.pool.query("SELECT max(version) AS version FROM schema_migrations");
      if (!Number.isSafeInteger(Number(migration.rows[0]?.version)) || Number(migration.rows[0]?.version) < MIN_SCHEMA_VERSION) {
        throw new Error("Database migrations are incomplete.");
      }
    })().catch((error: unknown) => { this.verification = undefined; throw error; });
    await this.verification;
  }

  async all<Row extends QueryResultRow = Record<string, unknown>>(sql: string, values: readonly unknown[] = []): Promise<Row[]> {
    await this.ready();
    return (await (this.client ?? this.pool).query<Row>(sql, [...values])).rows;
  }

  async get<Row extends QueryResultRow = Record<string, unknown>>(sql: string, values: readonly unknown[] = []): Promise<Row | undefined> {
    return (await this.all<Row>(sql, values))[0];
  }

  async run(sql: string, values: readonly unknown[] = []): Promise<void> {
    await this.ready();
    await (this.client ?? this.pool).query(sql, [...values]);
  }

  async transaction<T>(work: (db: Database) => Promise<T>): Promise<T> {
    return this.transact(work, false);
  }

  async readSnapshot<T>(work: (db: Database) => Promise<T>): Promise<T> {
    return this.client ? work(this) : this.transact(work, true);
  }

  private async transact<T>(work: (db: Database) => Promise<T>, readOnly: boolean): Promise<T> {
    if (this.client) throw new Error("Nested database transactions are not supported.");
    await this.ready();
    const client = await this.pool.connect();
    try {
      await client.query(readOnly ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN");
      const result = await work(new Database(this.pool, client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async close() {
    if (this.client) throw new Error("A transaction does not own its pool.");
    await this.pool.end();
  }
}

export function openDatabase(connectionString: string, environments?: readonly DatabaseEnvironment[]): Database {
  const pool = new Pool(poolOptions(connectionString));
  pool.on("error", () => console.error(JSON.stringify({ event: "database_connection_error" })));
  return new Database(pool, undefined, environments);
}

export async function migrate(db: Database, environment: DatabaseEnvironment) {
  await db.transaction(async (tx) => {
    await tx.run("SELECT pg_advisory_xact_lock(hashtext('wedding-wishlist-schema'))");
    const tables = await tx.all<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname=current_schema()");
    if (tables.length) {
      if (!tables.some((table) => table.tablename === "app_metadata")) throw new Error("Refusing to modify an unmarked database.");
      const marker = await tx.get("SELECT value FROM app_metadata WHERE key='environment'");
      if (marker?.value !== environment) throw new Error("Database environment does not match; no migration applied.");
    }
    await tx.run("CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
    for (const [version, file] of [[1, "001_core.sql"], [2, "002_auth.sql"], [3, "003_optional_timestamp.sql"], [4, "004_auth_email.sql"], [5, "005_goal_history.sql"], [6, "006_live_upi.sql"]] as const) {
      if (!await tx.get("SELECT version FROM schema_migrations WHERE version=$1", [version])) {
        await tx.run(readFileSync(resolve("migrations", "postgres", file), "utf8"));
        if (version === 1) await tx.run("INSERT INTO app_metadata VALUES('environment',$1)", [environment]);
        await tx.run("INSERT INTO schema_migrations(version) VALUES($1)", [version]);
      }
    }
  });
}

export async function grantRuntime(db: Database, role: string) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(role)) throw new Error("An explicit restricted database runtime role is required.");
  await db.run(`GRANT USAGE ON SCHEMA public TO "${role}"`);
  for (const [permissions, tables] of WEB_RUNTIME_GRANTS) {
    for (const table of tables) await db.run(`GRANT ${permissions} ON ${table} TO "${role}"`);
  }
}

export async function grantEmailRuntime(db: Database, role: string) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(role)) throw new Error("An explicit restricted email database role is required.");
  await db.run(`GRANT USAGE ON SCHEMA public TO "${role}"`);
  for (const table of ["app_metadata", "schema_migrations"]) await db.run(`GRANT SELECT ON ${table} TO "${role}"`);
  for (const table of ["auth_email_outbox", "auth_email_budgets"]) {
    await db.run(`GRANT SELECT,INSERT,UPDATE,DELETE ON ${table} TO "${role}"`);
  }
}

export function configuredDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (process.env.DEMO_MODE !== "local-only") throw new Error("DATABASE_URL is not configured.");
  const config: unknown = JSON.parse(readFileSync(resolve("data", "local-postgres.json"), "utf8"));
  if (!config || typeof config !== "object" || !("applicationUrl" in config) || typeof config.applicationUrl !== "string") {
    throw new Error("Run npm run db:local to configure the isolated local PostgreSQL database.");
  }
  return config.applicationUrl;
}

let connection: Database | undefined;
export function getDatabase(): Database {
  connection ??= openDatabase(configuredDatabaseUrl(), process.env.APP_ENV === "production" ? ["production"] : ["synthetic-demo-only", "test"]);
  return connection;
}
