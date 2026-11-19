-- Versioned direct-UPI recipient setup and reviewed live activation.
-- Real money stays off by default: every wishlist starts in demo mode, and only a
-- deliberate per-wishlist owner activation (reauthenticated, reviewed in the app layer)
-- can move a report-free wishlist to live direct-UPI instructions. The transition is
-- one-way and can never rewrite a wishlist that already holds guest reports.

CREATE TABLE recipient_versions(
  id TEXT PRIMARY KEY,
  wishlist_id TEXT NOT NULL REFERENCES wishlists(id),
  version INTEGER NOT NULL CHECK(version>0),
  upi_id TEXT NOT NULL CHECK(length(upi_id) BETWEEN 3 AND 100),
  label TEXT NOT NULL CHECK(length(btrim(label)) BETWEEN 1 AND 100),
  actor_id TEXT NOT NULL REFERENCES users(id),
  created_at utc_timestamp NOT NULL,
  UNIQUE(wishlist_id,version),
  UNIQUE(id,wishlist_id)
);
CREATE TRIGGER recipient_versions_no_change BEFORE UPDATE OR DELETE ON recipient_versions
  FOR EACH ROW EXECUTE FUNCTION deny_history_change();

ALTER TABLE wishlists DROP CONSTRAINT wishlists_payment_mode_check;
ALTER TABLE wishlists ADD CONSTRAINT wishlists_payment_mode_check CHECK(payment_mode IN ('demo','upi'));
ALTER TABLE wishlists DROP CONSTRAINT wishlists_funding_policy_check;
ALTER TABLE wishlists ADD CONSTRAINT wishlists_funding_policy_check CHECK(funding_policy IN ('undecided','allow_overfunding'));
ALTER TABLE wishlists ADD COLUMN live_recipient_id TEXT;
ALTER TABLE wishlists ADD CONSTRAINT wishlists_live_recipient_fk
  FOREIGN KEY(live_recipient_id,id) REFERENCES recipient_versions(id,wishlist_id);
ALTER TABLE wishlists ADD CONSTRAINT wishlists_live_consistency CHECK(
  (payment_mode='demo' AND live_recipient_id IS NULL AND funding_policy='undecided') OR
  (payment_mode='upi' AND live_recipient_id IS NOT NULL AND funding_policy='allow_overfunding')
);

CREATE OR REPLACE FUNCTION deny_payment_policy_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.payment_mode IS DISTINCT FROM OLD.payment_mode THEN
    IF NOT (OLD.payment_mode='demo' AND NEW.payment_mode='upi') THEN
      RAISE EXCEPTION 'Payment mode cannot change back or to an unsupported mode';
    END IF;
    IF EXISTS(SELECT 1 FROM public.contributions WHERE wishlist_id=OLD.id) THEN
      RAISE EXCEPTION 'A wishlist with existing reports can never change payment mode';
    END IF;
  END IF;
  IF NEW.funding_policy IS DISTINCT FROM OLD.funding_policy AND
    NOT (OLD.funding_policy='undecided' AND NEW.funding_policy='allow_overfunding') THEN
    RAISE EXCEPTION 'Funding policy cannot change once set';
  END IF;
  RETURN NEW;
END; $$;

ALTER TABLE contributions ALTER COLUMN recipient_snapshot_id DROP NOT NULL;
ALTER TABLE contributions ADD COLUMN recipient_version_id TEXT;
ALTER TABLE contributions ADD CONSTRAINT contributions_recipient_binding CHECK(
  (recipient_snapshot_id IS NOT NULL AND recipient_version_id IS NULL) OR
  (recipient_snapshot_id IS NULL AND recipient_version_id IS NOT NULL)
);
ALTER TABLE contributions ADD CONSTRAINT contributions_recipient_version_fk
  FOREIGN KEY(recipient_version_id,wishlist_id) REFERENCES recipient_versions(id,wishlist_id);
