"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ClaimDashboard, ClaimStatus, OwnerClaim } from "@/lib/claims";
import { formatINR } from "@/lib/money";
import { requestJson } from "./client-api";
import { ConfirmAction } from "./confirm-action";
import { useRequestLock } from "./use-request-lock";

export function ClaimsDashboard({ wishlistId, initial }: { wishlistId: string; initial: ClaimDashboard }) {
  const router = useRouter();
  const [loaded, setLoaded] = useState<ClaimDashboard | null>(null);
  const [filter, setFilter] = useState("all");
  const defaultView = filter === "all" && (!loaded || loaded.page === 1);
  const data = loaded && (!defaultView || loaded.revision >= initial.revision) ? loaded : initial;
  const changedFilteredView = Boolean(!defaultView && loaded && initial.revision > loaded.revision);
  const [reason, setReason] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const { busy, start, finish } = useRequestLock();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [confirmClaim, setConfirmClaim] = useState<OwnerClaim | null>(null);
  const reviewDisabled = busy || refreshFailed || changedFilteredView;
  async function load(nextFilter: string, page: number) {
    const result = await requestJson<ClaimDashboard>(`/api/owner/wishlists/${wishlistId}/reports?status=${nextFilter}&page=${page}`, "GET");
    setLoaded(result); setFilter(nextFilter); setRefreshFailed(false);
  }
  async function refresh(nextFilter = filter, page = data.page) {
    if (!start()) return;
    setError(""); setMessage("");
    try {
      await load(nextFilter, page);
    } catch (error) { setRefreshFailed(true); setError(error instanceof Error ? error.message : "Could not load reports."); }
    finally { finish(); }
  }
  async function resolve(claim: OwnerClaim, status: ClaimStatus) {
    if (refreshFailed || changedFilteredView || !start()) return false;
    setError(""); setMessage("");
    let saved = false;
    try {
      await requestJson(`/api/owner/wishlists/${wishlistId}/reports/${claim.id}`, "PATCH", { status, version: claim.version, reason, acknowledged });
      saved = true; setReason(""); setAcknowledged(false);
      await load(filter, data.page);
      setMessage("Report updated with an append-only event. No bank verification or refund was performed.");
      return true;
    } catch (error) {
      setRefreshFailed(true);
      setError(saved ? "The review was saved, but reports could not refresh. Refresh reports before another action."
        : error instanceof Error ? error.message : "Update outcome unknown. Refresh before retrying.");
      return saved;
    } finally { if (saved) router.refresh(); finish(); }
  }
  return <section className="panel claims-dashboard" aria-labelledby="reports-title">
    <h2 id="reports-title">Guest reports and manual confirmation</h2>
    <p><strong>Demo - no real money.</strong> Never confirm from a screenshot or reference alone. For live direct UPI, compare against your own bank records. The platform cannot verify a bank transfer or refund money it never handled.</p>
    <dl className="totals-grid">
      <div><dt>Reported, not confirmed</dt><dd>{formatINR(data.totals.reportedPaise)}</dd></div>
      <div><dt>Needs review</dt><dd>{formatINR(data.totals.needsReviewPaise)}</dd></div>
      <div><dt>Owner-confirmed demo reports</dt><dd>{formatINR(data.totals.ownerConfirmedPaise)}</dd></div>
      <div><dt>Rejected reports</dt><dd>{formatINR(data.totals.rejectedPaise)}</dd></div>
    </dl>
    <p>No provider-confirmed, settled or refunded funds exist in this demo.</p>
    <label htmlFor="report-filter">Filter reports</label><select id="report-filter" value={filter} disabled={busy} onChange={(e) => refresh(e.target.value, 1)}>{["all", "reported", "needs_review", "owner_confirmed", "rejected"].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select>
    <div className="actions"><button className="button secondary" disabled={busy} onClick={() => refresh()}>Refresh reports</button><a href={`/api/owner/wishlists/${wishlistId}/reports/export`}>Export private CSV (up to 5,000 rows)</a></div>
    {(refreshFailed || changedFilteredView) && <p className="notice">These reports may be out of date. Refresh reports before reviewing another gift.</p>}
    {(filter !== "all" || data.page !== 1) && <p className="muted">Filtered and paginated reports update when you refresh or review a report.</p>}
    <label htmlFor="review-reason">Reason for next review action (required)</label><textarea id="review-reason" disabled={busy} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
    <label className="checkbox-label"><input type="checkbox" disabled={busy} checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} /> I understand confirmation is manual, not bank verification.</label>
    <small>Enter a fresh reason and acknowledgement for each confirmation.</small>
    {error && !confirmClaim && <p role="alert" className="error-box">{error}</p>}<p role="status">{message}</p>
    {!data.claims.length && <p>No reports match this filter. Reported gifts will appear here privately.</p>}
    <ul className="report-list">{data.claims.map((claim) => <li key={claim.id}>
      <h3>{formatINR(claim.amountPaise)} - {claim.guestName || "Name not provided"}</h3>
      <p>{claim.goalTitle} / {claim.status.replaceAll("_", " ")}</p>
      <p className="story">{claim.guestMessage || "No message."}</p>
      <p>Reference: {claim.reference || "Not provided"}. <small>{claim.id}</small></p>
      {claim.duplicateReference && <p className="error-box">Duplicate reference: review required. References can be forged.</p>}
      <div className="actions">
        {["reported", "needs_review"].includes(claim.status) && <><button className="button" disabled={reviewDisabled || !reason.trim() || !acknowledged} onClick={() => resolve(claim, "owner_confirmed")}>Confirm demo report</button><button className="button secondary" disabled={reviewDisabled || !reason.trim()} onClick={() => resolve(claim, "rejected")}>Reject report</button></>}
        {claim.status !== "needs_review" && <button className="button secondary" disabled={reviewDisabled || !reason.trim()} onClick={() => {
          if (claim.status === "owner_confirmed") { setError(""); setConfirmClaim(claim); }
          else void resolve(claim, "needs_review");
        }}>{claim.status === "owner_confirmed" ? "Reverse confirmation into review" : "Mark needs review"}</button>}
      </div>
    </li>)}</ul>
    <div className="actions"><button className="button secondary" disabled={busy || data.page === 1} onClick={() => refresh(filter, data.page - 1)}>Previous page</button><span>Page {data.page}; {data.total} matching reports</span><button className="button secondary" disabled={busy || data.page * 50 >= data.total} onClick={() => refresh(filter, data.page + 1)}>Next page</button></div>
    {confirmClaim && <ConfirmAction title="Reverse this confirmation?" label="Reverse confirmation" busy={busy} error={error}
      onCancel={() => { setConfirmClaim(null); setError(""); }}
      onConfirm={async () => { if (await resolve(confirmClaim, "needs_review")) setConfirmClaim(null); }}>
      <p>This removes {formatINR(confirmClaim.amountPaise)} from confirmed progress and moves the report into review. It does not refund or move money.</p>
    </ConfirmAction>}
  </section>;
}
