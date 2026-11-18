import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

export type DatabaseEnvironment = "synthetic-demo-only" | "production" | "test";

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
  constructor(pool: Pool, client?: PoolClient) { this.pool = pool; this.client = client; }

  async all<Row extends QueryResultRow = Record<string, unknown>>(sql: string, values: readonly unknown[] = []): Promise<Row[]> {
    return (await (this.client ?? this.pool).query<Row>(sql, [...values])).rows;
  }

  async get<Row extends QueryResultRow = Record<string, unknown>>(sql: string, values: readonly unknown[] = []): Promise<Row | undefined> {
    return (await this.all<Row>(sql, values))[0];
  }

  async run(sql: string, values: readonly unknown[] = []): Promise<void> {
    await (this.client ?? this.pool).query(sql, [...values]);
  }

  async transaction<T>(work: (db: Database) => Promise<T>): Promise<T> {
    if (this.client) throw new Error("Nested database transactions are not supported.");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
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

export function openDatabase(connectionString: string): Database {
  const pool = new Pool(poolOptions(connectionString));
  pool.on("error", () => console.error(JSON.stringify({ event: "database_connection_error" })));
  return new Database(pool);
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
    for (const [version, file] of [[1, "001_core.sql"], [2, "002_auth.sql"], [3, "003_optional_timestamp.sql"]] as const) {
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
  for (const table of ["app_metadata", "schema_migrations"]) await db.run(`GRANT SELECT ON ${table} TO "${role}"`);
  for (const table of ["users", "memberships", "audit_entries", "recipient_snapshots", "claim_events"]) await db.run(`GRANT SELECT,INSERT ON ${table} TO "${role}"`);
  for (const table of ["wishlists", "goals", "contributions"]) await db.run(`GRANT SELECT,INSERT,UPDATE ON ${table} TO "${role}"`);
  for (const table of ["auth_users", "auth_sessions", "auth_accounts", "auth_verifications", "auth_rate_limits", "rate_limits", "auth_local_outbox"]) {
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
  connection ??= openDatabase(configuredDatabaseUrl());
  return connection;
}
