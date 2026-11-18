CREATE TABLE auth_email_outbox(
  id TEXT PRIMARY KEY, dedup_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK(kind IN ('verification','recovery')),
  payload BYTEA, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL,
  available_at TIMESTAMPTZ NOT NULL, attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  state TEXT NOT NULL CHECK(state IN ('queued','leased','accepted','failed','unknown','expired')),
  lease_token TEXT, lease_until TIMESTAMPTZ, uncertain BOOLEAN NOT NULL DEFAULT false,
  provider_id TEXT, error_class TEXT CHECK(error_class IN ('network','provider','rejected','invalid_response','invalid_payload')),
  CHECK((state IN ('queued','leased') AND payload IS NOT NULL) OR (state NOT IN ('queued','leased') AND payload IS NULL)),
  CHECK((state='leased' AND lease_token IS NOT NULL AND lease_until IS NOT NULL) OR
        (state<>'leased' AND lease_token IS NULL AND lease_until IS NULL)),
  CHECK(state<>'accepted' OR provider_id IS NOT NULL)
);
CREATE INDEX auth_email_available ON auth_email_outbox(available_at) WHERE state IN ('queued','leased');
CREATE TABLE auth_email_budgets(
  period TEXT PRIMARY KEY, attempts INTEGER NOT NULL CHECK(attempts>0), expires_at TIMESTAMPTZ NOT NULL
);
