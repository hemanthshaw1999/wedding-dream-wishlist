CREATE DOMAIN utc_timestamp AS TEXT
  CHECK(VALUE ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' AND VALUE::timestamptz IS NOT NULL);
CREATE TABLE app_metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE users(id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('fictional-demo','account')), created_at utc_timestamp NOT NULL);
CREATE TABLE wishlists(
  id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE CHECK(length(slug) BETWEEN 3 AND 60),
  display_names TEXT NOT NULL CHECK(length(display_names) BETWEEN 1 AND 100),
  story TEXT NOT NULL CHECK(length(story)<=2000), wedding_date TEXT,
  expires_at utc_timestamp, visibility TEXT NOT NULL CHECK(visibility IN ('unlisted','public','private')),
  state TEXT NOT NULL CHECK(state IN ('draft','published','paused','closed','archived')),
  currency TEXT NOT NULL CHECK(currency='INR'), payment_mode TEXT NOT NULL CHECK(payment_mode='demo'),
  funding_policy TEXT NOT NULL CHECK(funding_policy='undecided'),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at utc_timestamp NOT NULL, updated_at utc_timestamp NOT NULL
);
CREATE TABLE memberships(
  wishlist_id TEXT NOT NULL REFERENCES wishlists(id), user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK(role='owner'), PRIMARY KEY(wishlist_id,user_id)
);
CREATE TABLE goals(
  id TEXT PRIMARY KEY, wishlist_id TEXT NOT NULL REFERENCES wishlists(id),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 100),
  description TEXT NOT NULL CHECK(length(description)<=1000),
  target_paise NUMERIC NOT NULL CHECK(target_paise=trunc(target_paise) AND target_paise BETWEEN 1 AND 1000000000),
  position INTEGER NOT NULL CHECK(position>=0), UNIQUE(wishlist_id,position), UNIQUE(id,wishlist_id)
);
CREATE TABLE audit_entries(
  id TEXT PRIMARY KEY, wishlist_id TEXT NOT NULL REFERENCES wishlists(id), actor_id TEXT NOT NULL REFERENCES users(id),
  event TEXT NOT NULL, from_state TEXT, to_state TEXT NOT NULL, created_at utc_timestamp NOT NULL
);
CREATE FUNCTION deny_history_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'History is immutable and append-only'; END; $$;
CREATE TRIGGER audit_no_change BEFORE UPDATE OR DELETE ON audit_entries FOR EACH ROW EXECUTE FUNCTION deny_history_change();
CREATE FUNCTION deny_payment_policy_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.payment_mode IS DISTINCT FROM OLD.payment_mode OR NEW.funding_policy IS DISTINCT FROM OLD.funding_policy THEN
    RAISE EXCEPTION 'Payment mode/funding policy migration is not implemented';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER payment_policy_immutable BEFORE UPDATE ON wishlists FOR EACH ROW EXECUTE FUNCTION deny_payment_policy_change();
CREATE TABLE rate_limits(bucket TEXT PRIMARY KEY, count INTEGER NOT NULL CHECK(count>0), expires_at BIGINT NOT NULL);
CREATE INDEX rate_limits_expiry ON rate_limits(expires_at);
CREATE TABLE auth_local_outbox(
  id TEXT PRIMARY KEY, recipient TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('verification','recovery')),
  url TEXT NOT NULL, created_at utc_timestamp NOT NULL
);
CREATE TABLE recipient_snapshots(
  id TEXT PRIMARY KEY, wishlist_id TEXT NOT NULL UNIQUE REFERENCES wishlists(id),
  label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 100), mode TEXT NOT NULL CHECK(mode='demo'),
  created_at utc_timestamp NOT NULL, UNIQUE(id,wishlist_id)
);
CREATE TRIGGER recipient_no_change BEFORE UPDATE OR DELETE ON recipient_snapshots FOR EACH ROW EXECUTE FUNCTION deny_history_change();
CREATE TABLE contributions(
  id TEXT PRIMARY KEY, wishlist_id TEXT NOT NULL REFERENCES wishlists(id), goal_id TEXT NOT NULL,
  recipient_snapshot_id TEXT NOT NULL,
  amount_paise NUMERIC NOT NULL CHECK(amount_paise=trunc(amount_paise) AND amount_paise BETWEEN 100 AND 10000000),
  currency TEXT NOT NULL CHECK(currency='INR'), guest_name TEXT NOT NULL CHECK(length(guest_name)<=100),
  guest_message TEXT NOT NULL CHECK(length(guest_message)<=500), reference TEXT NOT NULL CHECK(length(reference)<=64),
  status TEXT NOT NULL CHECK(status IN ('reported','needs_review','owner_confirmed','rejected')),
  token_hash TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL, token_expires_at utc_timestamp NOT NULL,
  version INTEGER NOT NULL CHECK(version>0), created_at utc_timestamp NOT NULL, updated_at utc_timestamp NOT NULL,
  FOREIGN KEY(goal_id,wishlist_id) REFERENCES goals(id,wishlist_id),
  FOREIGN KEY(recipient_snapshot_id,wishlist_id) REFERENCES recipient_snapshots(id,wishlist_id)
);
CREATE INDEX contributions_wishlist_created ON contributions(wishlist_id,created_at);
CREATE INDEX contributions_goal_status ON contributions(goal_id,status);
CREATE INDEX contributions_reference ON contributions(wishlist_id,reference);
CREATE FUNCTION deny_contribution_terms_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW)-ARRAY['status','version','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','updated_at']) THEN
    RAISE EXCEPTION 'Contribution terms are immutable';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER contribution_terms_immutable BEFORE UPDATE ON contributions FOR EACH ROW EXECUTE FUNCTION deny_contribution_terms_change();
CREATE TRIGGER contribution_no_delete BEFORE DELETE ON contributions FOR EACH ROW EXECUTE FUNCTION deny_history_change();
CREATE TABLE claim_events(
  id TEXT PRIMARY KEY, contribution_id TEXT NOT NULL REFERENCES contributions(id), actor_id TEXT REFERENCES users(id),
  from_status TEXT, to_status TEXT NOT NULL CHECK(to_status IN ('reported','needs_review','owner_confirmed','rejected')),
  confirmed_delta_paise NUMERIC NOT NULL CHECK(confirmed_delta_paise=trunc(confirmed_delta_paise) AND abs(confirmed_delta_paise)<=10000000),
  reason TEXT NOT NULL CHECK(length(reason)<=300), created_at utc_timestamp NOT NULL
);
CREATE INDEX claim_events_contribution ON claim_events(contribution_id);
CREATE TRIGGER claim_events_no_change BEFORE UPDATE OR DELETE ON claim_events FOR EACH ROW EXECUTE FUNCTION deny_history_change();
CREATE FUNCTION enforce_claim_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE claim_id TEXT; expected NUMERIC; actual NUMERIC;
BEGIN
  IF TG_TABLE_NAME='contributions' THEN claim_id:=NEW.id; ELSE claim_id:=NEW.contribution_id; END IF;
  SELECT CASE WHEN status='owner_confirmed' THEN amount_paise ELSE 0 END INTO expected FROM contributions WHERE id=claim_id;
  SELECT COALESCE(SUM(confirmed_delta_paise),0) INTO actual FROM claim_events WHERE contribution_id=claim_id;
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Contribution ledger mismatch'; END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER contribution_balance_guard AFTER INSERT OR UPDATE ON contributions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_claim_balance();
CREATE CONSTRAINT TRIGGER event_balance_guard AFTER INSERT ON claim_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_claim_balance();
