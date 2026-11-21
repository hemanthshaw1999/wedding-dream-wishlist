-- Guest list with private per-guest RSVP links. The couple records who they invited; each guest
-- receives a private link (random token, only its hash is stored) where they answer Yes/No and can
-- set an expected arrival time. No contact details are collected and no messages are sent by the app.

CREATE TABLE wishlist_guests(
  id TEXT PRIMARY KEY,
  wishlist_id TEXT NOT NULL REFERENCES wishlists(id),
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),
  normalized_name TEXT NOT NULL,
  rsvp TEXT NOT NULL DEFAULT 'pending' CHECK(rsvp IN ('pending','attending','not_attending')),
  expected_arrival TEXT CHECK(expected_arrival IS NULL OR expected_arrival ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  rsvp_updated_at utc_timestamp,
  token_hash TEXT NOT NULL UNIQUE,
  created_at utc_timestamp NOT NULL,
  removed_at utc_timestamp
);
CREATE INDEX wishlist_guests_wishlist ON wishlist_guests(wishlist_id);
-- One active entry per guest name per wedding; a removed name can be invited again.
CREATE UNIQUE INDEX wishlist_guests_unique_active ON wishlist_guests(wishlist_id, normalized_name) WHERE removed_at IS NULL;

-- Removal is a one-way flag, never a row delete: the restricted runtime role keeps its
-- no-DELETE posture and the couple-facing audit trail keeps the history that matters.
