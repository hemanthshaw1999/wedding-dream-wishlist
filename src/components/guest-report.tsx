"use client";

import Image from "next/image";
import { WeddingFlourish, WeddingEnvelope, WeddingMark } from "./wedding-mark";
import QRCode from "qrcode";
import { useState } from "react";
import type { Goal, PublicWishlist } from "@/lib/wishlist";
import type { ClaimReceipt } from "@/lib/claims";
import { formatINR, parseINR } from "@/lib/money";
import { buildUpiUri } from "@/lib/upi";
import { CheckIcon, CopyIcon, EditIcon, HeartIcon } from "./icons";
import { requestJson } from "./client-api";
import { useRequestLock } from "./use-request-lock";

export function GuestReport({ wishlist, goal }: { wishlist: PublicWishlist; goal: Goal }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("500");
  const [showPublicly, setShowPublicly] = useState(false);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [reference, setReference] = useState("");
  const [review, setReview] = useState(false);
  const [qr, setQr] = useState("");
  const { busy, start, finish } = useRequestLock();
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<ClaimReceipt | null>(null);
  const [privateUrl, setPrivateUrl] = useState("");
  const [payQr, setPayQr] = useState("");
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const [statusCopied, setStatusCopied] = useState(false);
  const [showStatusLink, setShowStatusLink] = useState(false);
  const [statusCopyError, setStatusCopyError] = useState("");
  const recipient = wishlist.recipientSnapshot;
  const live = wishlist.paymentMode === "upi" ? wishlist.liveRecipient : null;
  const field = (name: string) => `${goal.id}-${name}`;
  const liveLate = Boolean(live) && wishlist.availability === "paused";
  if (wishlist.paymentMode === "upi" && !live) {
    return <p>Reports are unavailable for this wishlist while live payments are disabled for this deployment.</p>;
  }
  if (goal.archivedAt || (!live && (!recipient || wishlist.availability !== "available")) || (live && !["available", "paused"].includes(wishlist.availability))) {
    return <p>Reports are unavailable for this {goal.archivedAt ? "archived goal" : "wishlist"}.</p>;
  }
  async function prepare(event: React.FormEvent) {
    event.preventDefault();
    if (!start()) return;
    setError("");
    try {
      const paise = parseINR(amount);
      if (paise < 100 || paise > 10_000_000) throw new Error("Use INR 1 to INR 1,00,000.");
      if (live) {
        setPayQr(await QRCode.toDataURL(buildUpiUri({ upiId: live.upiId, payeeName: live.label, amountPaise: paise, note: goal.title }), { width: 220, margin: 3 }));
      } else {
        setQr(await QRCode.toDataURL(`NOT-PAYABLE|${JSON.stringify({ goal: goal.id, amountPaise: paise, recipient: recipient?.id })}`, { width: 220, margin: 3 }));
      }
      setReview(true);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not prepare the gift report."); }
    finally { finish(); }
  }
  async function copyUpiId() {
    if (!live) return;
    try { await navigator.clipboard.writeText(live.upiId); setCopied(true); }
    catch { setCopied(false); setError("Copy failed. Long-press the UPI ID and copy it manually."); }
  }
  async function copyStatusLink() {
    setStatusCopyError("");
    try { await navigator.clipboard.writeText(privateUrl); setStatusCopied(true); }
    catch { setStatusCopied(false); setShowStatusLink(true); setStatusCopyError("Automatic copy is unavailable. Select the status link below and copy it manually."); }
  }
  async function report(event: React.FormEvent) {
    event.preventDefault();
    if (!start()) return;
    setError("");
    try {
      const storageKey = `wishlist-report:${goal.id}`;
      const existing = window.sessionStorage.getItem(storageKey);
      const token = existing || Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
      window.sessionStorage.setItem(storageKey, token);
      setPrivateUrl(`${window.location.origin}/gift-status#${token}`);
      const result = await requestJson<ClaimReceipt>(`/api/public/wishlists/${wishlist.slug}/reports`, "POST", {
        goalId: goal.id, ...(live ? { recipientVersionId: live.id } : { recipientSnapshotId: recipient?.id }), amount, currency: "INR",
        guestName: name, guestMessage: message, reference, token, publicDisplay: showPublicly && name.trim().length > 0
      });
      setReceipt(result);
    } catch (error) { setError(error instanceof Error ? error.message : "The outcome is unknown. Use the private status link before repeating a report."); }
    finally { finish(); }
  }
  return (
    <div className="guest-report">
      {!open && <button className="button secondary" onClick={() => setOpen(true)}>Choose a gift</button>}
      {open && !review && <form onSubmit={prepare}>
        <fieldset className="form-fields" disabled={busy} aria-label="Gift details">
        <p className="gift-intro">A little love for their next chapter</p>
        {live ? <>
          <p>Pay {live.label} at UPI ID <strong>{live.upiId}</strong> in your own UPI app first, then tell them here what you paid.</p>
          {liveLate && <p role="note"><strong>Gifting is paused.</strong> Only report a gift you have already paid.</p>}
        </> : <p>This app doesn&apos;t take payments. Please don&apos;t enter payment or bank details.</p>}
        <label htmlFor={field("amount")}>Gift amount (₹)</label>
        <div className="actions">{["500", "2000", "5000"].map((preset) => <button key={preset} type="button" className="button secondary" aria-pressed={amount === preset} onClick={() => setAmount(preset)}>{formatINR(Number(preset) * 100)}</button>)}</div>
        <input id={field("amount")} required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <small>Any amount from ₹1 to ₹1,00,000.</small>
        <details className="optional-fields wishes-fields"><summary><HeartIcon />Add your wishes for the couple <span>(optional)</span></summary>
        <label htmlFor={field("message")}>Your wishes for the couple (optional)</label><textarea id={field("message")} placeholder="Wishing you a lifetime of love, laughter and little adventures together..." maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} />
        <small>Only the couple can read your message.</small>
        <label htmlFor={field("name")}>Your name (optional)</label><input id={field("name")} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        <label className="checkbox-label"><input type="checkbox" checked={showPublicly} onChange={(e) => setShowPublicly(e.target.checked)} /> List my name as a supporter once confirmed, ranked by gift size. My exact amount stays hidden.</label>
        <label htmlFor={field("reference")}>{live ? "UPI reference (optional)" : "Reference (optional)"}</label><input id={field("reference")} maxLength={64} value={reference} onChange={(e) => setReference(e.target.value)} autoComplete="off" />
        </details>
        <div className="actions"><button className="button">{busy ? "One moment..." : "Continue"}</button></div>
        </fieldset>
      </form>}
      {review && !receipt && <form onSubmit={report}>
        <WeddingEnvelope />
        <h4>A gift with love</h4>
        {message.trim() && <blockquote className="wishes-preview"><HeartIcon /><p>{message}</p><small>Your private wishes for the couple</small></blockquote>}
        {live ? <>
          <p className="review-line"><strong>{goal.title}</strong> · {formatINR(parseINR(amount))}</p>
          <p className="review-line">To {live.label} · UPI ID <strong>{live.upiId}</strong>
            <button type="button" className="icon-button small" aria-label={copied ? "UPI ID copied" : "Copy UPI ID"} onClick={copyUpiId}>{copied ? <CheckIcon /> : <CopyIcon />}</button></p>
          <div className="actions">
            <a className="button" href={buildUpiUri({ upiId: live.upiId, payeeName: live.label, amountPaise: parseINR(amount), note: goal.title })}>Pay {formatINR(parseINR(amount))} with your UPI app</a>
          </div>
          <button type="button" className="text-button" aria-expanded={qrOpen} onClick={() => setQrOpen(!qrOpen)}>{qrOpen ? "Hide the QR code" : "On a computer? Show a QR to scan"}</button>
          {qrOpen && payQr && <figure><Image src={payQr} width={220} height={220} unoptimized alt={`UPI payment QR for ${live.label}, ${formatINR(parseINR(amount))}`} /><figcaption>Scan this with your phone&apos;s UPI app.</figcaption></figure>}
          <p className="muted">Paying happens in your own UPI app - this app cannot see it. Send this report after paying; the couple confirms your gift from their account, and only then it counts toward the goal.</p>
          <button type="button" className="text-button" aria-expanded={howOpen} onClick={() => setHowOpen(!howOpen)}>How paying works</button>
          {howOpen && <p className="muted">The Pay button or QR only opens your UPI app with the recipient, amount and note already filled in - check the recipient name before you pay. Your payment never passes through this app, so the app cannot confirm it. When you send this report, the couple sees it, checks their own account, and marks your gift confirmed. Until they do, it does not count toward the goal.</p>}
          <label className="checkbox-label"><input type="checkbox" required /> I have paid this amount to the UPI ID above.</label>
          <div className="actions"><button className="button" disabled={busy}>Send to the couple</button><button type="button" className="button secondary" disabled={busy} onClick={() => setReview(false)}><EditIcon />Edit details</button></div>
        </> : <>
          <p>{goal.title}<br />{formatINR(parseINR(amount))} for {recipient?.label}</p>
          {qr && <Image src={qr} width={220} height={220} unoptimized alt="Illustrative QR - not payable and not a UPI QR" />}
                    <label className="checkbox-label"><input type="checkbox" required /> I understand this records my gift but does not make a payment.</label>
          <div className="actions"><button className="button" disabled={busy}>Send to the couple</button><button type="button" className="button secondary" disabled={busy} onClick={() => setReview(false)}><EditIcon />Edit details</button></div>
        </>}
      </form>}
      {error && <p role="alert" className="error-box">{error}</p>}
      {receipt && <div role="status" className="gift-celebration"><WeddingFlourish celebration /><WeddingMark /><h4>Thank you! The couple has been told.</h4><p>Thank you for being part of their next chapter. The couple will confirm your gift from their account; it counts toward the goal after that.</p></div>}
      {privateUrl && <div className="gift-status-actions"><div className="actions"><a className="button secondary" href={privateUrl}>Check status</a><button type="button" className="button secondary" aria-label={statusCopied ? "Status link copied" : "Copy status link"} onClick={copyStatusLink}>{statusCopied ? <CheckIcon /> : <CopyIcon />}{statusCopied ? "Copied" : "Copy link"}</button></div><p className="muted">Save your status link for seven days. Anyone holding it can see this gift&apos;s status. Keep it to yourself.</p>{statusCopyError && <p role="alert" className="error-box">{statusCopyError}</p>}<details open={showStatusLink || undefined}><summary>Show status link</summary><label htmlFor={field("status")}>Your status link</label><input id={field("status")} readOnly value={privateUrl} onFocus={(event) => event.target.select()} /></details></div>}
    </div>
  );
}
