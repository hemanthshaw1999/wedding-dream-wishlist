"use client";

import Image from "next/image";
import QRCode from "qrcode";
import { useState } from "react";
import type { Goal, PublicWishlist } from "@/lib/wishlist";
import type { ClaimReceipt } from "@/lib/claims";
import { formatINR, parseINR } from "@/lib/money";
import { requestJson } from "./client-api";
import { useRequestLock } from "./use-request-lock";

export function GuestReport({ wishlist, goal }: { wishlist: PublicWishlist; goal: Goal }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("500");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [reference, setReference] = useState("");
  const [review, setReview] = useState(false);
  const [qr, setQr] = useState("");
  const { busy, start, finish } = useRequestLock();
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<ClaimReceipt | null>(null);
  const [privateUrl, setPrivateUrl] = useState("");
  const recipient = wishlist.recipientSnapshot;
  const field = (name: string) => `${goal.id}-${name}`;
  if (!recipient || wishlist.availability !== "available" || goal.archivedAt) return <p>Demo reports are unavailable for this {goal.archivedAt ? "archived goal" : "wishlist"}.</p>;
  async function prepare(event: React.FormEvent) {
    event.preventDefault();
    if (!start()) return;
    setError("");
    try {
      const paise = parseINR(amount);
      if (paise < 100 || paise > 10_000_000) throw new Error("Use INR 1 to INR 1,00,000.");
      setQr(await QRCode.toDataURL(`DEMO-NOT-PAYABLE|${JSON.stringify({ goal: goal.id, amountPaise: paise, recipient: recipient?.id })}`, { width: 220, margin: 3 }));
      setReview(true);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not prepare the demo report."); }
    finally { finish(); }
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
        goalId: goal.id, recipientSnapshotId: recipient?.id, amount, currency: "INR",
        guestName: name, guestMessage: message, reference, token
      });
      setReceipt(result);
    } catch (error) { setError(error instanceof Error ? error.message : "The outcome is unknown. Use the private status link before repeating a report."); }
    finally { finish(); }
  }
  return (
    <div className="guest-report">
      {!open && <button className="button secondary" onClick={() => setOpen(true)}>Choose a demo gift</button>}
      {open && !review && <form onSubmit={prepare}>
        <fieldset className="form-fields" disabled={busy} aria-label="Demo gift details">
        <p><strong>Demo - no real money.</strong> No transfer happens here. Do not enter real payment or bank details.</p>
        <label htmlFor={field("amount")}>Gift amount (INR)</label>
        <div className="actions">{["500", "2000", "5000"].map((preset) => <button key={preset} type="button" className="button secondary" aria-pressed={amount === preset} onClick={() => setAmount(preset)}>{formatINR(Number(preset) * 100)}</button>)}</div>
        <input id={field("amount")} required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <small>Custom amount: INR 1 to INR 1,00,000. No minimum-gift expectation; gifting is optional.</small>
        <label htmlFor={field("name")}>Guest name (optional, private)</label><input id={field("name")} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        <label htmlFor={field("message")}>Message (optional, private)</label><textarea id={field("message")} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} />
        <label htmlFor={field("reference")}>Fictional reference (optional, not proof)</label><input id={field("reference")} maxLength={64} value={reference} onChange={(e) => setReference(e.target.value)} autoComplete="off" />
        <div className="actions"><button className="button">{busy ? "Preparing..." : "Review demo gift"}</button></div>
        </fieldset>
      </form>}
      {review && !receipt && <form onSubmit={report}>
        <h4>Review before reporting</h4>
        <p><strong>Demo - no real money.</strong></p><p>Goal: {goal.title}<br />Recipient label: {recipient.label}<br />Amount: {formatINR(parseINR(amount))} INR</p>
        {qr && <Image src={qr} width={220} height={220} unoptimized alt="Demo instruction QR - not payable and not a UPI QR" />}
        <p>This QR is non-payable. In the future direct-UPI version, the UPI app must show the expected recipient before the guest authorizes payment.</p>
        <p>A report, screenshot, reference or UPI-app return is not proof of receipt. Only the couple can manually confirm after checking bank records.</p>
        <label className="checkbox-label"><input type="checkbox" required /> I understand this only submits a demo declaration.</label>
        <div className="actions"><button className="button" disabled={busy}>Submit demo report</button><button type="button" className="text-button" disabled={busy} onClick={() => setReview(false)}>Edit details</button></div>
      </form>}
      {error && <p role="alert" className="error-box">{error}</p>}
      {receipt && <div role="status"><h4>Report saved - not verified</h4><p>Reference: {receipt.id}</p><p>Status: {receipt.status}. Reported money does not increase confirmed progress.</p></div>}
      {privateUrl && <div><label htmlFor={field("status")}>Private status link - keep it secret</label><input id={field("status")} readOnly value={privateUrl} onFocus={(event) => event.target.select()} /><a href={privateUrl}>Check your private report status</a><p className="muted">Expires after seven days. The browser keeps only its random report key in this tab&apos;s session storage for safe retries; names/messages are not saved there.</p></div>}
    </div>
  );
}
