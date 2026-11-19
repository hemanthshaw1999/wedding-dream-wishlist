-- Owner-entered cash/envelope gifts. Kept apart from guest reports so the two sources are
-- never mixed: guest reports stay manual-confirmation claims; cash entries are written only
-- by the couple. Entries are append-only except for a one-way void.

CREATE TABLE cash_gifts(
  id TEXT PRIMARY KEY,
  wishlist_id TEXT NOT NULL REFERENCES wishlists(id),
  goal_id TEXT NOT NULL,
  amount_paise NUMERIC NOT NULL CHECK(amount_paise=trunc(amount_paise) AND amount_paise BETWEEN 100 AND 10000000),
  donor_name TEXT NOT NULL CHECK(length(donor_name)<=100),
  note TEXT NOT NULL CHECK(length(note)<=300),
  actor_id TEXT NOT NULL REFERENCES users(id),
  created_at utc_timestamp NOT NULL,
  voided_at utc_timestamp,
  FOREIGN KEY(goal_id,wishlist_id) REFERENCES goals(id,wishlist_id)
);
CREATE INDEX cash_gifts_goal ON cash_gifts(goal_id);
CREATE INDEX cash_gifts_wishlist_created ON cash_gifts(wishlist_id,created_at);

CREATE FUNCTION deny_cash_gift_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.voided_at IS NOT NULL OR NEW.voided_at IS NULL OR
    (to_jsonb(NEW)-'voided_at') IS DISTINCT FROM (to_jsonb(OLD)-'voided_at') THEN
    RAISE EXCEPTION 'Cash gifts are append-only; only a one-way void is allowed';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER cash_gifts_void_only BEFORE UPDATE ON cash_gifts FOR EACH ROW EXECUTE FUNCTION deny_cash_gift_change();
CREATE TRIGGER cash_gifts_no_delete BEFORE DELETE ON cash_gifts FOR EACH ROW EXECUTE FUNCTION deny_history_change();

-- Guest opt-in to appear (name and amount) on the supporters list shown to viewers of that wishlist.
-- Existing rows default to private and stay private.
ALTER TABLE contributions ADD COLUMN public_display BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE contributions ADD CONSTRAINT contributions_public_needs_name CHECK(NOT public_display OR length(trim(guest_name))>0);
