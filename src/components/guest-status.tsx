"use client";

import { useState } from "react";
import { WeddingMark } from "./wedding-mark";
import type { ClaimReceipt } from "@/lib/claims";
import { formatINR } from "@/lib/money";
import { requestJson } from "./client-api";
import { useRequestLock } from "./use-request-lock";

export function GuestStatus() {
  const [token, setToken] = useState("");
  const [receipt, setReceipt] = useState<ClaimReceipt | null>(null);
  const [error, setError] = useState("");
  const [storageWarning, setStorageWarning] = useState("");
  const { busy, start, finish } = useRequestLock();
  async function check() {
    if (!start()) return;
    setError(""); setReceipt(null); setStorageWarning("");
    try {
      let key = window.location.hash.slice(1) || token;
      try {
        key ||= window.sessionStorage.getItem("wishlist-private-status") || "";
        if (/^[a-f0-9]{64}$/.test(key)) window.sessionStorage.setItem("wishlist-private-status", key);
        else window.sessionStorage.removeItem("wishlist-private-status");
      } catch { setStorageWarning("This browser cannot keep your private key in this tab. Save the original private link before reloading."); }
      setToken(key);
      window.history.replaceState(null, "", "/gift-status");
      const result = await requestJson<ClaimReceipt>("/api/guest/status", "POST", { token: key });
      if (window.location.hash && window.location.hash.slice(1) !== key) {
        setError("A different private link was opened. Check status again to see that gift.");
        return;
      }
      window.history.replaceState(null, "", "/gift-status");
      setReceipt(result);
    }
    catch (error) { setError(error instanceof Error ? error.message : "Could not check the report."); }
    finally { finish(); }
  }
  async function withdraw() {
    if (!start()) return;
    setError("");
    try {
      const key = token || window.sessionStorage.getItem("wishlist-private-status") || "";
      setReceipt(await requestJson<ClaimReceipt>("/api/guest/withdraw", "POST", { token: key }));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not remove the listing."); }
    finally { finish(); }
  }
  function forget() {
    const fragment = window.location.hash.slice(1);
    setToken(""); setReceipt(null); setError(""); setStorageWarning("");
    window.history.replaceState(null, "", "/gift-status");
    try {
      const storage = window.sessionStorage;
      const key = fragment || token || storage.getItem("wishlist-private-status");
      for (const name of Object.keys(storage)) {
        if (/^wishlist-report:[a-f0-9-]{36}$/.test(name) && storage.getItem(name) === key) storage.removeItem(name);
      }
      storage.removeItem("wishlist-private-status");
    }
    catch { setError("Could not clear this tab's stored key. Clear this site's browser data or close this tab on a shared device."); }
  }
  return <section className="panel prose gift-status"><WeddingMark /><h1>Your gift</h1><p className="gift-intro">A little love, sent their way.</p><p>See whether the couple has confirmed it. Anyone holding your private link can see this status. Keep it to yourself.</p><div className="actions"><button className="button" disabled={busy} onClick={check}>{busy ? "Checking..." : "Check status"}</button><button className="text-button" disabled={busy} onClick={forget}>Forget this link on this device</button></div>{storageWarning && <p role="status" className="notice">{storageWarning}</p>}{error && <p role="alert" className="error-box">{error}</p>}{receipt && <div role="status"><h2>{({ owner_confirmed: "Confirmed by the couple", reported: "Waiting for the couple to confirm", needs_review: "The couple is looking into it", rejected: "The couple could not confirm this gift" } as Record<string, string>)[receipt.status] ?? receipt.status.replaceAll("_", " ")}</h2><p>{formatINR(receipt.amountPaise)} toward {receipt.goalTitle}</p>{receipt.listedPublicly && <div><p>You chose to be listed as a supporter, ranked by gift size once confirmed. Your exact amount stays hidden.</p><button className="button secondary" disabled={busy} onClick={withdraw}>Remove me from the supporters list</button><p className="muted">Your gift still counts. Only your name is removed from the list.</p></div>}<p className="muted">This is not a tax receipt.</p></div>}</section>;
}
