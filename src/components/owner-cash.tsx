"use client";

import { useState } from "react";
import type { OwnerWishlist } from "@/lib/wishlist";
import { formatINR } from "@/lib/money";
import type { CashGift } from "@/server/cash-store";
import { requestJson, RequestError } from "./client-api";
import { useRequestLock } from "./use-request-lock";

export function OwnerCash({ wishlist, initial }: { wishlist: OwnerWishlist; initial: CashGift[] }) {
  const goals = wishlist.goals.filter((goal) => !goal.archivedAt);
  const locked = wishlist.state === "archived" || goals.length === 0;
  const [gifts, setGifts] = useState(initial);
  const [adding, setAdding] = useState(false);
  const [goalId, setGoalId] = useState(goals[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const { busy, start, finish } = useRequestLock();

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!start()) return;
    setError(""); setMessage("");
    try {
      setGifts(await requestJson<CashGift[]>(`/api/owner/wishlists/${wishlist.id}/cash`, "POST", { goalId, amount, donorName: name, note }));
      setAmount(""); setName(""); setNote(""); setAdding(false);
      setMessage("Cash gift added. It now counts toward the goal. Refresh the page to see updated progress.");
    } catch (caught) { setError(caught instanceof RequestError ? caught.message : "Could not add the cash gift."); }
    finally { finish(); }
  }
  async function voidGift(id: string) {
    if (!start()) return;
    setError(""); setMessage("");
    try {
      setGifts(await requestJson<CashGift[]>(`/api/owner/wishlists/${wishlist.id}/cash/${id}`, "DELETE"));
      setMessage("Entry voided. It no longer counts toward the goal; the record is kept.");
    } catch (caught) { setError(caught instanceof RequestError ? caught.message : "Could not void the entry."); }
    finally { finish(); }
  }

  return (
    <section id="cash-gifts" className="panel" aria-labelledby="cash-title">
      <h2 id="cash-title">Cash gifts</h2>
      <p className="muted">For the love and blessings handed to you in person. Don&apos;t add gifts already reported online.</p>
      {!locked && <button type="button" className="button secondary" disabled={busy} aria-expanded={adding} onClick={() => setAdding(!adding)}>{adding ? "Cancel cash entry" : "Record cash gift"}</button>}
      {locked ? <p>This wishlist cannot take new entries.</p> : adding && (
        <form onSubmit={add}>
          <p className="muted">Name and note stay private. Don&apos;t record the same gift twice.</p>
          <label htmlFor="cash-goal">Goal</label>
          <select id="cash-goal" value={goalId} onChange={(e) => setGoalId(e.target.value)}>
            {goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}
          </select>
          <label htmlFor="cash-amount">Amount (₹)</label>
          <input id="cash-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="2000" required />
          <label htmlFor="cash-name">From (optional)</label>
          <input id="cash-name" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          <label htmlFor="cash-note">Note (optional)</label>
          <input id="cash-note" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} autoComplete="off" />
          <div className="actions"><button className="button" disabled={busy} type="submit">Add cash gift</button></div>
        </form>
      )}
      {error && <p role="alert" className="error">{error}</p>}
      {message && <p role="status">{message}</p>}
      {gifts.length > 0 && <ul className="report-list">
        {gifts.map((gift) => (
          <li key={gift.id}>
            <strong>{formatINR(gift.amountPaise)}</strong> for {gift.goalTitle}{gift.donorName ? `, from ${gift.donorName}` : ", name not recorded"}
            {gift.note ? ` (${gift.note})` : ""}. Cash entry{gift.voidedAt ? ", voided" : ""}.
            {!gift.voidedAt && !locked && <> <button className="button secondary" disabled={busy} onClick={() => voidGift(gift.id)}>Void entry</button></>}
          </li>
        ))}
      </ul>}
    </section>
  );
}
