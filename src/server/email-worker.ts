import { emailOutboxConfig } from "./config.ts";
import { openDatabase, type Database } from "./database.ts";
import { dispatchAuthEmail } from "./email.ts";
import { assertDatabaseReady } from "./readiness.ts";

type Environment = Readonly<Record<string, string | undefined>>;
type Outcome = Awaited<ReturnType<typeof dispatchAuthEmail>>;

export function emailWorkerNeedsAttention(outcome: Outcome) {
  return ["failed", "unknown", "quota", "retry", "lease_lost"].includes(outcome);
}

export async function runEmailWorker(options: {
  env?: Environment; createDatabase?: (url: string) => Database; fetcher?: typeof fetch;
} = {}): Promise<Outcome> {
  const env = options.env ?? process.env;
  const config = emailOutboxConfig(env);
  if (!env.RESEND_API_KEY || !env.DATABASE_URL) throw new Error("Worker-only provider and runtime database credentials are required.");
  const database = (options.createDatabase ?? ((url) => openDatabase(url, ["production"])))(env.DATABASE_URL);
  try {
    await assertDatabaseReady(database);
    const scope = await database.get<{ broad: boolean }>(`SELECT EXISTS(SELECT 1 FROM pg_tables
      WHERE schemaname='public' AND tablename NOT IN ('app_metadata','schema_migrations','auth_email_outbox','auth_email_budgets')
      AND has_table_privilege(current_user,format('%I.%I',schemaname,tablename),
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) AS broad`);
    if (scope?.broad !== false) throw new Error("A separately restricted email-only runtime role is required.");
    return await dispatchAuthEmail(database, { key: config.key, apiKey: env.RESEND_API_KEY, ...(options.fetcher ? { fetcher: options.fetcher } : {}) });
  } finally { await database.close(); }
}
