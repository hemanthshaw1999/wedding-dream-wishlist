"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ClaimDashboard, ClaimStatus, OwnerClaim } from "@/lib/claims";
import { formatINR } from "@/lib/money";
import { requestJson } from "./client-api";

export function ClaimsDashboard({ wishlistId, initial }: { wishlistId: string; initial: ClaimDashboard }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [filter, setFilter] = useState("all");
  const [reason, setReason] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function refresh(nextFilter = filter, page = data.page) {
    setBusy(true); setError("");
    try {
      const result = await requestJson<ClaimDashboard>(`/api/owner/wishlists/${wishlistId}/reports?status=${nextFilter}&page=${page}`, "GET");
      setData(result); setFilter(nextFilter);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not load reports."); }
    finally { setBusy(false); }
  }
  async function resolve(claim: OwnerClaim, status: ClaimStatus) {
    setBusy(true); setError(""); setMessage("");
    try {
      await requestJson(`/api/owner/wishlists/${wishlistId}/reports/${claim.id}`, "PATCH", { status, version: claim.version, reason, acknowledged });
      setMessage("Report updated with an append-only event. No bank verification or refund was performed.");
      await refresh();
      router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Update outcome unknown. Refresh before retrying."); }
    finally { setBusy(false); }
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
    <label htmlFor="review-reason">Reason for next review action (required)</label><textarea id="review-reason" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
    <label className="checkbox-label"><input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} /> I understand confirmation is manual, not bank verification.</label>
    {error && <p role="alert" className="error-box">{error}</p>}<p role="status">{message}</p>
    {!data.claims.length && <p>No reports match this filter. Reported gifts will appear here privately.</p>}
    <ul className="report-list">{data.claims.map((claim) => <li key={claim.id}>
      <h3>{formatINR(claim.amountPaise)} - {claim.guestName || "Name not provided"}</h3>
      <p>{claim.goalTitle} / {claim.status.replaceAll("_", " ")}</p>
      <p className="story">{claim.guestMessage || "No message."}</p>
      <p>Reference: {claim.reference || "Not provided"}. <small>{claim.id}</small></p>
      {claim.duplicateReference && <p className="error-box">Duplicate reference: review required. References can be forged.</p>}
      <div className="actions">
        {["reported", "needs_review"].includes(claim.status) && <><button className="button" disabled={busy || !reason.trim() || !acknowledged} onClick={() => resolve(claim, "owner_confirmed")}>Confirm demo report</button><button className="button secondary" disabled={busy || !reason.trim()} onClick={() => resolve(claim, "rejected")}>Reject report</button></>}
        {claim.status !== "needs_review" && <button className="button secondary" disabled={busy || !reason.trim()} onClick={() => resolve(claim, "needs_review")}>{claim.status === "owner_confirmed" ? "Reverse confirmation into review" : "Mark needs review"}</button>}
      </div>
    </li>)}</ul>
    <div className="actions"><button className="button secondary" disabled={busy || data.page === 1} onClick={() => refresh(filter, data.page - 1)}>Previous page</button><span>Page {data.page}; {data.total} matching reports</span><button className="button secondary" disabled={busy || data.page * 50 >= data.total} onClick={() => refresh(filter, data.page + 1)}>Next page</button></div>
  </section>;
}
