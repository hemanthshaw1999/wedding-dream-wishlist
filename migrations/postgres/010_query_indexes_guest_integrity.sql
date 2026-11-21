-- Owner lookup starts with user_id; the existing membership PK starts with wishlist_id.
-- INCLUDE keeps the join key available without widening the search/sort key.
CREATE INDEX memberships_user_wishlists ON memberships(user_id) INCLUDE(wishlist_id);

-- Guest list is capped at 1000 active rows per wedding. EXPLAIN ANALYZE uses the existing
-- wishlist_id index and a sub-millisecond in-memory sort, so no extra order/covering index.

-- Match the public, confirmed-only top-supporter query, not private/rejected reports.
CREATE INDEX contributions_public_supporters ON contributions(wishlist_id,amount_paise DESC,created_at)
  WHERE status='owner_confirmed' AND public_display;

ALTER TABLE wishlist_guests ADD CONSTRAINT guest_normalized_name_matches
  CHECK(normalized_name=lower(name));
ALTER TABLE wishlist_guests ADD CONSTRAINT guest_arrival_requires_attending
  CHECK(expected_arrival IS NULL OR rsvp='attending');
ALTER TABLE wishlist_guests ADD CONSTRAINT guest_token_is_hash
  CHECK(token_hash ~ '^[0-9a-f]{64}$');
