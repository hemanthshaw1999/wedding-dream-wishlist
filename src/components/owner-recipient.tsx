"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { OwnerWishlist, RecipientVersionView } from "@/lib/wishlist";
import { requestJson, RequestError } from "./client-api";
import { ConfirmAction } from "./confirm-action";
import { useRequestLock } from "./use-request-lock";

export function OwnerRecipient({ wishlist }: { wishlist: OwnerWishlist; production?: boolean }) {
  const router = useRouter();
  const { busy, start, finish } = useRequestLock();
  const [versions, setVersions] = useState<RecipientVersionView[] | null>(null);
  const [upiId, setUpiId] = useState("");
  const [editing, setEditing] = useState(false);
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

  // Saving a recipient version does not bump wishlist.version, so the effect above does not re-run;
  // refetch explicitly or the new version stays invisible until a full page reload.
  async function reloadVersions() {
    try {
      const result = await requestJson<{ versions: RecipientVersionView[] }>(`/api/owner/wishlists/${wishlist.id}/recipient`, "GET");
      setVersions(result.versions);
    } catch { setError("Recipient versions could not be loaded. Refresh before changing payment setup."); }
  }

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
      await reloadVersions();
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
      setConfirmUpiId(""); setAcknowledged(false); setEditing(false);
      setMessage("Live direct-UPI instructions are now active. Earlier reports were not converted.");
      await reloadVersions();
      router.refresh();
      return true;
    } catch (error) { failed(error, "Could not activate live instructions."); return false; }
    finally { finish(); }
  }

  return (
    <section id="payment-setup" className="panel" aria-labelledby="payment-setup-title">
      <h2 id="payment-setup-title">Where guests pay</h2>
      {wishlist.paymentMode === "demo" ? (
        <p><strong>Gifting is not open yet.</strong> Add your UPI ID below to let guests send gifts.</p>
      ) : (
        <p><strong>{wishlist.state === "published" ? "Gifting is open." : wishlist.state === "paused" ? "Gifting is paused." : "UPI details saved."}</strong> Recipient: {live?.label} at <strong>{live?.upiId}</strong>. Check your bank before confirming each gift.</p>
      )}
      {changeable && <>
        {live && <button type="button" className="button secondary" disabled={busy} aria-expanded={editing} onClick={() => setEditing(!editing)}>{editing ? "Cancel UPI change" : "Change UPI details"}</button>}
        {(!live || editing) && <form onSubmit={addVersion} aria-busy={busy}>
          <fieldset className="form-fields" disabled={busy} aria-label="New recipient version">
            <h3>Add your UPI ID</h3>
            <p className="muted">This app only checks the format. Make sure the UPI ID is yours before you turn it on. Guests see it only after that.</p>
            <label htmlFor="recipient-upi">Your UPI ID</label>
            <input id="recipient-upi" required maxLength={100} autoComplete="off" value={upiId} onChange={(e) => setUpiId(e.target.value)} aria-invalid={Boolean(fields.upiId)} aria-describedby={fields.upiId ? "error-upiId" : "recipient-upi-hint"} />
            <small id="recipient-upi-hint">For example name@bank. Never a QR screenshot, phone gallery upload or payment link.</small>
            {fields.upiId && <span className="field-error" id="error-upiId">{fields.upiId}</span>}
            <label htmlFor="recipient-label">Name guests will see</label>
            <input id="recipient-label" required maxLength={100} autoComplete="off" value={label} onChange={(e) => setLabel(e.target.value)} aria-invalid={Boolean(fields.label)} aria-describedby={fields.label ? "error-label" : undefined} />
            {fields.label && <span className="field-error" id="error-label">{fields.label}</span>}
            <div className="actions"><button className="button secondary" disabled={busy} type="submit">{busy ? "Saving..." : "Save"}</button></div>
          </fieldset>
        </form>}
        {versions === null ? <p role="status">Loading recipient versions...</p> : versions.length > 0 && <>
          <details className="history-disclosure"><summary>Saved versions</summary>
          <ol>
            {versions.map((version) => <li key={version.id}>
              Version {version.version}: <strong>{version.upiId}</strong> ({version.label}){live?.id === version.id ? " - active now" : ""}
            </li>)}
          </ol></details>
          {versions[0]?.id !== live?.id && <div className="actions">
            <button className="button secondary" disabled={busy} onClick={() => { setError(""); setConfirming(true); }}>
              {wishlist.paymentMode === "demo" ? "Review and enable live UPI" : "Switch to the latest version after review"}
            </button>
          </div>}
        </>}
      </>}
      {error && !confirming && <p role="alert" className="error-box">{error}</p>}
      {reauthRequired && !confirming && <p><Link href={`/owner?${new URLSearchParams({ next: `/owner/${wishlist.id}` })}`}>Sign in again</Link> to change payment setup. Nothing was changed.</p>}
      {message && <p role="status">{message}</p>}
      {confirming && versions?.[0] && <ConfirmAction title={wishlist.paymentMode === "demo" ? "Enable live direct-UPI payments?" : "Switch the active recipient version?"}
        label={wishlist.paymentMode === "demo" ? "Enable live UPI instructions" : "Switch active recipient"} busy={busy} error={error}
        onCancel={() => { setConfirming(false); setError(""); setConfirmUpiId(""); setAcknowledged(false); }}
        onConfirm={async () => { if (await activate()) setConfirming(false); }}>
        <p>Guests will pay <strong>{versions[0].label}</strong> at <strong>{versions[0].upiId}</strong> in their own UPI app. This app never handles the money.</p>
        {wishlist.paymentMode === "demo" && <p>This cannot be undone.</p>}
        <label htmlFor="confirm-upi">Re-enter the exact UPI ID to confirm you reviewed it in your UPI app</label>
        <input id="confirm-upi" required maxLength={100} autoComplete="off" value={confirmUpiId} onChange={(e) => setConfirmUpiId(e.target.value)} aria-invalid={Boolean(fields.confirmUpiId)} aria-describedby={fields.confirmUpiId ? "error-confirmUpiId" : undefined} />
        {fields.confirmUpiId && <span className="field-error" id="error-confirmUpiId">{fields.confirmUpiId}</span>}
        <label className="checkbox-label"><input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} /> This UPI ID is mine, and I know a guest&apos;s message or screenshot is not proof of payment.</label>
      </ConfirmAction>}
    </section>
  );
}
