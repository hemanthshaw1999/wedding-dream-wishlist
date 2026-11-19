ALTER TABLE goals ADD COLUMN archived_at utc_timestamp;
ALTER TABLE goals ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE goals DROP CONSTRAINT goals_wishlist_id_position_key;
ALTER TABLE goals ADD CONSTRAINT goals_wishlist_id_position_key UNIQUE(wishlist_id,position) DEFERRABLE INITIALLY IMMEDIATE;

CREATE TABLE goal_history(
  goal_id TEXT NOT NULL, wishlist_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version>0),
  actor_id TEXT REFERENCES users(id),
  event TEXT NOT NULL CHECK(event IN ('baseline','created','updated','archived','restored','reordered')),
  reason TEXT NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 300),
  before_snapshot JSONB, after_snapshot JSONB NOT NULL,
  created_at utc_timestamp NOT NULL,
  PRIMARY KEY(goal_id,version),
  FOREIGN KEY(goal_id,wishlist_id) REFERENCES goals(id,wishlist_id) DEFERRABLE INITIALLY DEFERRED,
  CHECK((event='baseline' AND actor_id IS NULL) OR (event<>'baseline' AND actor_id IS NOT NULL))
);
CREATE INDEX goal_history_wishlist ON goal_history(wishlist_id,created_at DESC);
INSERT INTO goal_history(goal_id,wishlist_id,version,actor_id,event,reason,before_snapshot,after_snapshot,created_at)
  SELECT id,wishlist_id,version,NULL,'baseline',
    'History tracking began; earlier changes are not reconstructed.',NULL,to_jsonb(goals),
    to_char(current_timestamp AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') FROM goals;
CREATE TRIGGER goal_history_no_change BEFORE UPDATE OR DELETE ON goal_history FOR EACH ROW EXECUTE FUNCTION deny_history_change();
CREATE TRIGGER goal_no_delete BEFORE DELETE ON goals FOR EACH ROW EXECUTE FUNCTION deny_history_change();

CREATE FUNCTION record_goal_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  actor TEXT := nullif(current_setting('app.actor_id',true),'');
  change_reason TEXT := btrim(current_setting('app.change_reason',true));
  parent_state TEXT;
  parent_expiry TEXT;
  change_event TEXT := 'updated';
  before_value JSONB;
  confirmed NUMERIC;
  change_time TEXT := to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
  IF TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW.wishlist_id<>OLD.wishlist_id) THEN
    RAISE EXCEPTION 'Goal identity is immutable';
  END IF;
  SELECT state,expires_at INTO parent_state,parent_expiry FROM public.wishlists WHERE id=NEW.wishlist_id FOR UPDATE;
  IF actor IS NULL OR change_reason IS NULL OR length(change_reason) NOT BETWEEN 1 AND 300 OR
    NOT EXISTS(SELECT 1 FROM public.memberships WHERE wishlist_id=NEW.wishlist_id AND user_id=actor AND role='owner') THEN
    RAISE EXCEPTION 'Goal changes require an authenticated owner and reason';
  END IF;
  IF parent_state IN ('closed','archived') OR parent_expiry<=change_time THEN
    RAISE EXCEPTION 'Closed or expired wishlists cannot change goals';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.version<>1 OR NEW.archived_at IS NOT NULL THEN RAISE EXCEPTION 'New goals must start active at version one'; END IF;
    IF (SELECT count(*) FROM public.goals WHERE wishlist_id=NEW.wishlist_id)>=20 THEN RAISE EXCEPTION 'A wishlist can retain at most 20 goals'; END IF;
    change_event := 'created';
  ELSE
    IF (to_jsonb(NEW)-'version') IS NOT DISTINCT FROM (to_jsonb(OLD)-'version') THEN RAISE EXCEPTION 'No goal change'; END IF;
    IF OLD.archived_at IS NOT NULL AND
      (NEW.title,NEW.description,NEW.target_paise) IS DISTINCT FROM (OLD.title,OLD.description,OLD.target_paise) THEN
      RAISE EXCEPTION 'Restore an archived goal before editing it';
    END IF;
    IF (NEW.title,NEW.description) IS DISTINCT FROM (OLD.title,OLD.description) AND
      EXISTS(SELECT 1 FROM public.contributions WHERE goal_id=OLD.id) THEN
      RAISE EXCEPTION 'Reported goal purpose is immutable';
    END IF;
    IF NEW.target_paise<>OLD.target_paise THEN
      SELECT COALESCE(sum(e.confirmed_delta_paise),0) INTO confirmed FROM public.contributions c
        JOIN public.claim_events e ON e.contribution_id=c.id WHERE c.goal_id=OLD.id;
      IF NEW.target_paise<confirmed THEN RAISE EXCEPTION 'Target cannot be below confirmed progress'; END IF;
      IF EXISTS(SELECT 1 FROM public.contributions WHERE goal_id=OLD.id) AND
        current_setting('app.target_change_acknowledged',true) IS DISTINCT FROM 'yes' THEN
        RAISE EXCEPTION 'Reported goal target changes require acknowledgement';
      END IF;
    END IF;
    IF NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
      IF NEW.archived_at IS NULL THEN change_event := 'restored';
      ELSIF OLD.archived_at IS NULL THEN
        NEW.archived_at := change_time;
        change_event := 'archived';
      ELSE RAISE EXCEPTION 'Archive timestamps cannot be rewritten';
      END IF;
    ELSIF NEW.position<>OLD.position AND
      (NEW.title,NEW.description,NEW.target_paise) IS NOT DISTINCT FROM (OLD.title,OLD.description,OLD.target_paise) THEN
      change_event := 'reordered';
    END IF;
    NEW.version := OLD.version+1;
    before_value := to_jsonb(OLD);
  END IF;
  INSERT INTO public.goal_history(goal_id,wishlist_id,version,actor_id,event,reason,before_snapshot,after_snapshot,created_at)
    VALUES(NEW.id,NEW.wishlist_id,NEW.version,actor,change_event,change_reason,before_value,to_jsonb(NEW),change_time);
  RETURN NEW;
END; $$;
CREATE TRIGGER goal_change_history BEFORE INSERT OR UPDATE ON goals FOR EACH ROW EXECUTE FUNCTION record_goal_change();
