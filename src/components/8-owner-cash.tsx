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
      setAmount(""); setName(""); setNote("");
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
      <p className="eyebrow">Cash and envelope gifts</p>
      <h2 id="cash-title">Add a cash gift you received</h2>
      <p>Use this for cash or envelopes handed to you in person. Add each real gift once. Do not add gifts that guests already reported through this app: those are confirmed in the reports below, and adding them here would count them twice. This app cannot check for duplicates between the two lists.</p>
      <p className="muted">The name and note are private to you. Guests only see goal totals.</p>
      {locked ? <p>This wishlist cannot take new entries.</p> : (
        <form onSubmit={add}>
          <label htmlFor="cash-goal">Goal</label>
          <select id="cash-goal" value={goalId} onChange={(e) => setGoalId(e.target.value)}>
            {goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}
          </select>
          <label htmlFor="cash-amount">Amount in INR</label>
          <input id="cash-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="2000" required />
          <label htmlFor="cash-name">Given by (optional, private)</label>
          <input id="cash-name" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          <label htmlFor="cash-note">Note (optional, private)</label>
          <input id="cash-note" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} autoComplete="off" />
          <div className="actions"><button className="button" disabled={busy} type="submit">Add cash gift</button></div>
        </form>
      )}
      {error && <p role="alert" className="error">{error}</p>}
      {message && <p role="status">{message}</p>}
      {gifts.length > 0 && <ul className="plain-list">
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
