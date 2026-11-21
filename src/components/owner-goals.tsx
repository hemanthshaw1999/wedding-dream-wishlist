"use client";

import { useState } from "react";
import type { GoalHistoryPage, OwnerGoal, OwnerWishlist } from "@/lib/wishlist";
import { formatINR } from "@/lib/money";
import { requestJson } from "./client-api";
import { useRequestLock } from "./use-request-lock";

type Draft = { id: string | null; title: string; description: string; target: string; version: number; acknowledged: boolean };
type Props = {
  wishlist: OwnerWishlist; busy: boolean;
  onChange: (command: Record<string, unknown>) => Promise<boolean>;
  onRefresh: () => void;
};

export function OwnerGoals({ wishlist, busy, onChange, onRefresh }: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [reason, setReason] = useState("");
  const [loadedHistory, setHistory] = useState<{ version: number; value: GoalHistoryPage } | null>(null);
  const history = loadedHistory?.version === wishlist.version ? loadedHistory.value : null;
  const { busy: historyBusy, start: startHistory, finish: finishHistory } = useRequestLock();
  const [historyError, setHistoryError] = useState("");
  const editable = !["closed", "archived", "expired"].includes(wishlist.availability);
  const selected = wishlist.goals.find((goal) => goal.id === draft?.id);
  const purposeLocked = selected?.hasReports === true;

  function edit(goal?: OwnerGoal) {
    setDraft({ id: goal?.id ?? null, title: goal?.title ?? "", description: goal?.description ?? "",
      target: goal ? (goal.targetPaise / 100).toFixed(2) : "", version: wishlist.version, acknowledged: false });
  }
  async function change(command: Record<string, unknown>) {
    const saved = await onChange({ ...command, reason });
    if (saved) { setHistory(null); setReason(""); }
    return saved;
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    const saved = await change({ action: draft.id ? "edit" : "add", version: draft.version,
      title: purposeLocked && selected ? selected.title : draft.title,
      description: purposeLocked && selected ? selected.description : draft.description, target: draft.target,
      ...(draft.id ? { goalId: draft.id, acknowledged: draft.acknowledged } : {}) });
    if (saved) setDraft(null);
  }
  async function move(index: number, offset: number) {
    const ids = wishlist.goals.map((goal) => goal.id);
    [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
    await change({ action: "reorder", goalIds: ids, version: wishlist.version });
  }
  async function loadHistory() {
    if (!startHistory()) return;
    setHistoryError("");
    try { setHistory({ version: wishlist.version, value: await requestJson<GoalHistoryPage>(`/api/owner/wishlists/${wishlist.id}/goals`, "GET") }); }
    catch (error) { setHistoryError(error instanceof Error ? error.message : "Could not load goal history."); }
    finally { finishHistory(); }
  }
  return (
    <section className="panel owner-controls" aria-labelledby="manage-goals-title">
      <details className="manage-goals"><summary className="section-summary"><h2 id="manage-goals-title">Manage goals</h2><span className="muted">{wishlist.goals.length} {wishlist.goals.length === 1 ? "goal" : "goals"}</span></summary>
      <p>Up to 20 goals. Archiving keeps gifts and progress.</p>
      {!editable && <p>Goals are read-only for a closed, archived or expired wishlist.</p>}
      {editable && <details className="goal-change-tools" open={Boolean(draft)}><summary>Change reason and reorder tools</summary>
        <label htmlFor="goal-change-reason">Reason for the change (private)</label>
        <input id="goal-change-reason" value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} disabled={busy} />
        <small>A reason of 1-300 characters is required for every edit, reorder, archive or restore. Guests see target revisions, not this reason.</small>
      </details>}
      <div className="actions">
        <button type="button" className="button secondary" onClick={() => edit()} disabled={!editable || busy || Boolean(draft) || wishlist.goals.length >= 20}>Add goal</button>
        <button type="button" className="button secondary" onClick={onRefresh} disabled={busy}>Refresh wishlist</button>
      </div>
      {draft && <form onSubmit={submit}>
        <fieldset disabled={busy || !editable}>
          <legend>{draft.id ? "Edit goal" : "New goal"}</legend>
          {purposeLocked && <p>A guest has reported against this goal. Its title and description are locked; unsaved purpose edits cannot be applied.</p>}
          <label htmlFor="edit-goal-title">Goal title</label>
          <input id="edit-goal-title" required maxLength={100} readOnly={purposeLocked} value={purposeLocked && selected ? selected.title : draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
          <label htmlFor="edit-goal-description">Goal description</label>
          <textarea id="edit-goal-description" maxLength={1000} readOnly={purposeLocked} value={purposeLocked && selected ? selected.description : draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
          <label htmlFor="edit-goal-target">Goal target amount (INR)</label>
          <input id="edit-goal-target" required inputMode="decimal" value={draft.target} onChange={(event) => setDraft({ ...draft, target: event.target.value })} />
          {purposeLocked && <label className="checkbox-label"><input type="checkbox" checked={draft.acknowledged} onChange={(event) => setDraft({ ...draft, acknowledged: event.target.checked })} /> I acknowledge that a target change after guest reports is visible in the public revision history.</label>}
          {draft.version !== wishlist.version && <p>Wishlist changed. Your input is preserved. Review the current goals below, then <button type="button" className="text-button" onClick={() => setDraft({ ...draft, version: wishlist.version })}>Use latest version after review</button>.</p>}
          <div className="actions">
            <button className="button" disabled={!reason.trim() || draft.version !== wishlist.version}>Save goal</button>
            <button type="button" className="text-button" onClick={() => setDraft(null)}>Cancel goal edit</button>
          </div>
        </fieldset>
      </form>}
      <ol className="report-list">
        {wishlist.goals.map((goal, index) => <li key={goal.id}>
          <h3>{goal.title}{goal.archivedAt ? " (archived)" : ""}</h3>
          <p>Target: {formatINR(goal.targetPaise)}. Confirmed: {formatINR(goal.confirmedPaise)}.</p>
          <div className="actions">
            <button type="button" className="button secondary" disabled={!editable || busy || Boolean(draft) || Boolean(goal.archivedAt)} onClick={() => edit(goal)} aria-label={`Edit ${goal.title}`}>Edit</button>
            <details className="goal-more"><summary>More actions</summary>
            <button type="button" className="button secondary" disabled={!editable || busy || Boolean(draft) || !reason.trim()} onClick={() => change({ action: goal.archivedAt ? "restore" : "archive", goalId: goal.id, version: wishlist.version })} aria-label={`${goal.archivedAt ? "Restore" : "Archive"} ${goal.title}`}>{goal.archivedAt ? "Restore" : "Archive"}</button>
            <button type="button" className="button secondary" disabled={!editable || busy || Boolean(draft) || !reason.trim() || index === 0} onClick={() => move(index, -1)} aria-label={`Move ${goal.title} up`}>Move up</button>
            <button type="button" className="button secondary" disabled={!editable || busy || Boolean(draft) || !reason.trim() || index === wishlist.goals.length - 1} onClick={() => move(index, 1)} aria-label={`Move ${goal.title} down`}>Move down</button></details>
          </div>
        </li>)}
      </ol>
      <details>
        <summary>Goal change history (private)</summary>
        <button type="button" className="button secondary" disabled={historyBusy || busy} onClick={loadHistory}>Load latest history</button>
        {historyError && <p role="alert" className="error-box">{historyError}</p>}
        {history && <>
          <p>Latest 100 entries. {history.hasMore ? "Older entries are retained in the database." : "All current entries shown."}</p>
          <ol className="report-list">{history.entries.map((entry) => <li key={`${entry.goalId}-${entry.version}`}>
            <strong>{entry.after.title}: {entry.event}, revision {entry.version}</strong>
            <p>{entry.createdAt} - {entry.reason}</p>
            <p>Target: {entry.before ? `${formatINR(entry.before.targetPaise)} to ` : ""}{formatINR(entry.after.targetPaise)}. Position: {entry.after.position + 1}. {entry.after.archivedAt ? "Archived." : "Active."}</p>
            {entry.before && (entry.before.title !== entry.after.title || entry.before.description !== entry.after.description) && <p>Previous purpose: {entry.before.title} - {entry.before.description || "(no description)"}. New purpose: {entry.after.title} - {entry.after.description || "(no description)"}.</p>}
          </li>)}</ol>
        </>}
      </details></details>
    </section>
  );
}
