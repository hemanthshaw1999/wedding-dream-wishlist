CREATE TABLE app_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;
INSERT INTO app_metadata VALUES ('environment', 'synthetic-demo-only');

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind = 'fictional-demo'),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL
) STRICT;
CREATE INDEX sessions_expiry ON sessions(expires_at);

CREATE TABLE wishlists (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE CHECK(length(slug) BETWEEN 3 AND 60),
  display_names TEXT NOT NULL CHECK(length(display_names) BETWEEN 1 AND 100),
  story TEXT NOT NULL CHECK(length(story) <= 2000),
  wedding_date TEXT,
  expires_at TEXT,
  visibility TEXT NOT NULL CHECK(visibility IN ('unlisted', 'public', 'private')),
  state TEXT NOT NULL CHECK(state IN ('draft', 'published', 'paused', 'closed', 'archived')),
  currency TEXT NOT NULL CHECK(currency = 'INR'),
  payment_mode TEXT NOT NULL CHECK(payment_mode = 'demo'),
  funding_policy TEXT NOT NULL CHECK(funding_policy = 'undecided'),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE memberships (
  wishlist_id TEXT NOT NULL REFERENCES wishlists(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK(role = 'owner'),
  PRIMARY KEY(wishlist_id, user_id)
) STRICT;

CREATE TABLE goals (
  id TEXT PRIMARY KEY,
  wishlist_id TEXT NOT NULL REFERENCES wishlists(id),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 100),
  description TEXT NOT NULL CHECK(length(description) <= 1000),
  target_paise INTEGER NOT NULL CHECK(target_paise BETWEEN 1 AND 1000000000),
  position INTEGER NOT NULL CHECK(position >= 0),
  UNIQUE(wishlist_id, position)
) STRICT;

CREATE TABLE audit_entries (
  id TEXT PRIMARY KEY,
  wishlist_id TEXT NOT NULL REFERENCES wishlists(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  event TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_entries
BEGIN SELECT RAISE(ABORT, 'Audit entries are append-only'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_entries
BEGIN SELECT RAISE(ABORT, 'Audit entries are append-only'); END;
CREATE TRIGGER payment_mode_immutable BEFORE UPDATE OF payment_mode ON wishlists
BEGIN SELECT RAISE(ABORT, 'Payment mode migration is not implemented'); END;
CREATE TRIGGER funding_policy_immutable BEFORE UPDATE OF funding_policy ON wishlists
BEGIN SELECT RAISE(ABORT, 'Funding policy decision is not implemented'); END;

CREATE TABLE rate_limits (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL CHECK(count > 0),
  expires_at INTEGER NOT NULL
) STRICT;
