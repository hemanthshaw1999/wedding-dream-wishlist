"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { OwnerWishlist, RecipientVersionView } from "@/lib/wishlist";
import { requestJson, RequestError } from "./client-api";
import { ConfirmAction } from "./confirm-action";
import { useRequestLock } from "./use-request-lock";

export function OwnerRecipient({ wishlist }: { wishlist: OwnerWishlist }) {
  const router = useRouter();
  const { busy, start, finish } = useRequestLock();
  const [versions, setVersions] = useState<RecipientVersionView[] | null>(null);
  const [upiId, setUpiId] = useState("");
  const [label, setLabel] = useState("");
  const [confirmUpiId, setConfirmUpiId] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [reauthRequired, setReauthRequired] = useState(false);
  const live = wishlist.liveRecipient;
  const changeable = !["closed", "archived"].includes(wishlist.state);

  useEffect(() => {
    let active = true;
    requestJson<{ versions: RecipientVersionView[] }>(`/api/owner/wishlists/${wishlist.id}/recipient`, "GET")
      .then((result) => { if (active) setVersions(result.versions); })
      .catch(() => { if (active) setError("Recipient versions could not be loaded. Refresh before changing payment setup."); });
    return () => { active = false; };
  }, [wishlist.id, wishlist.version]);

  function failed(error: unknown, fallback: string) {
    setError(error instanceof Error ? error.message : fallback);
    if (error instanceof RequestError) {
      setFields(error.fields);
      if (error.status === 403) setReauthRequired(true);
      if (error.status === 401) setReauthRequired(true);
    }
  }

  async function addVersion(event: React.FormEvent) {
    event.preventDefault();
    if (!start()) return;
    setError(""); setFields({}); setMessage(""); setReauthRequired(false);
    try {
      await requestJson(`/api/owner/wishlists/${wishlist.id}/recipient`, "POST", { upiId, label });
      setUpiId(""); setLabel("");
      setMessage("Recipient version saved. It is inert until you review and activate it below.");
      router.refresh();
    } catch (error) { failed(error, "Could not save the recipient version."); }
    finally { finish(); }
  }

  async function activate() {
    const target = versions?.[0];
    if (!target || !start()) return false;
    setError(""); setFields({}); setMessage(""); setReauthRequired(false);
    try {
      await requestJson(`/api/owner/wishlists/${wishlist.id}/live`, "POST", {
        version: wishlist.version, recipientVersionId: target.id, confirmUpiId, acknowledged
      });
      setConfirmUpiId(""); setAcknowledged(false);
      setMessage("Live direct-UPI instructions are now active. Demo history was not converted.");
      router.refresh();
      return true;
    } catch (error) { failed(error, "Could not activate live instructions."); return false; }
    finally { finish(); }
  }

  return (
    <section id="payment-setup" className="panel" aria-labelledby="payment-setup-title">
      <h2 id="payment-setup-title">Payment recipient setup</h2>
      {wishlist.paymentMode === "demo" ? (
        <p><strong>Demo - no real money.</strong> Guest reports are simulated. Add a recipient below only when this wishlist is meant for real direct-to-couple UPI gifts.</p>
      ) : (
        <p><strong>Live direct-to-couple UPI is active.</strong> Guests pay {live?.label} at UPI ID <strong>{live?.upiId}</strong> (instruction version {live?.version}). Overfunding is allowed and totals are shown truthfully. Confirmation always remains your manual bank-record check.</p>
      )}
      {changeable && <>
        <form onSubmit={addVersion} aria-busy={busy}>
          <fieldset className="form-fields" disabled={busy} aria-label="New recipient version">
            <h3>Add a recipient version</h3>
            <p className="muted">Only the UPI ID syntax is checked. Ownership is never verified by this app: confirm the recipient in your own UPI app before activating. Versions are immutable and never shown to guests until activated.</p>
            <label htmlFor="recipient-upi">Recipient UPI ID</label>
            <input id="recipient-upi" required maxLength={100} autoComplete="off" value={upiId} onChange={(e) => setUpiId(e.target.value)} aria-invalid={Boolean(fields.upiId)} aria-describedby={fields.upiId ? "error-upiId" : "recipient-upi-hint"} />
            <small id="recipient-upi-hint">For example name@bank. Never a QR screenshot, phone gallery upload or payment link.</small>
            {fields.upiId && <span className="field-error" id="error-upiId">{fields.upiId}</span>}
            <label htmlFor="recipient-label">Recipient label guests will see</label>
            <input id="recipient-label" required maxLength={100} autoComplete="off" value={label} onChange={(e) => setLabel(e.target.value)} aria-invalid={Boolean(fields.label)} aria-describedby={fields.label ? "error-label" : undefined} />
            {fields.label && <span className="field-error" id="error-label">{fields.label}</span>}
            <div className="actions"><button className="button secondary" disabled={busy} type="submit">{busy ? "Saving..." : "Save recipient version"}</button></div>
          </fieldset>
        </form>
        {versions === null ? <p role="status">Loading recipient versions...</p> : versions.length > 0 && <>
          <h3>Saved versions</h3>
          <ol>
            {versions.map((version) => <li key={version.id}>
              Version {version.version}: <strong>{version.upiId}</strong> ({version.label}){live?.id === version.id ? " - active now" : ""}
            </li>)}
          </ol>
          <div className="actions">
            <button className="button secondary" disabled={busy} onClick={() => { setError(""); setConfirming(true); }}>
              {wishlist.paymentMode === "demo" ? "Review and enable live UPI" : "Switch to the latest version after review"}
            </button>
          </div>
        </>}
      </>}
      {error && !confirming && <p role="alert" className="error-box">{error}</p>}
      {reauthRequired && !confirming && <p><Link href={`/owner?${new URLSearchParams({ next: `/owner/${wishlist.id}` })}`}>Sign in again</Link> to change payment setup. Nothing was changed.</p>}
      <p role="status">{message}</p>
      {confirming && versions?.[0] && <ConfirmAction title={wishlist.paymentMode === "demo" ? "Enable live direct-UPI payments?" : "Switch the active recipient version?"}
        label={wishlist.paymentMode === "demo" ? "Enable live UPI instructions" : "Switch active recipient"} busy={busy} error={error}
        onCancel={() => { setConfirming(false); setError(""); setConfirmUpiId(""); setAcknowledged(false); }}
        onConfirm={async () => { if (await activate()) setConfirming(false); }}>
        <p>Guests will be asked to pay <strong>{versions[0].label}</strong> at UPI ID <strong>{versions[0].upiId}</strong> (version {versions[0].version}) through their own UPI app. This app never collects, holds or verifies money; you confirm gifts only after checking your own bank records. Overfunding is allowed and totals are shown truthfully.</p>
        {wishlist.paymentMode === "demo" && <p>This cannot be undone and is only possible because this wishlist has no demo reports. A wishlist with existing demo reports can never become a live-payment wishlist.</p>}
        <label htmlFor="confirm-upi">Re-enter the exact UPI ID to confirm you reviewed it in your UPI app</label>
        <input id="confirm-upi" required maxLength={100} autoComplete="off" value={confirmUpiId} onChange={(e) => setConfirmUpiId(e.target.value)} aria-invalid={Boolean(fields.confirmUpiId)} aria-describedby={fields.confirmUpiId ? "error-confirmUpiId" : undefined} />
        {fields.confirmUpiId && <span className="field-error" id="error-confirmUpiId">{fields.confirmUpiId}</span>}
        <label className="checkbox-label"><input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} /> I verified this recipient in my own UPI app and understand reports, references and screenshots never prove receipt.</label>
      </ConfirmAction>}
    </section>
  );
}
