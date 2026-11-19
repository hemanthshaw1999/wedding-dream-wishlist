-- A guest can withdraw their public supporters-list listing through their private report link.
-- The contribution and its confirmed amount are untouched. Rows are insert-only.
CREATE TABLE supporter_withdrawals(
  contribution_id TEXT PRIMARY KEY REFERENCES contributions(id),
  withdrawn_at utc_timestamp NOT NULL
);
CREATE TRIGGER supporter_withdrawals_no_change BEFORE UPDATE OR DELETE ON supporter_withdrawals FOR EACH ROW EXECUTE FUNCTION deny_history_change();
