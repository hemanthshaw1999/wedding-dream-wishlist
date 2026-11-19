"use client";

import { useState } from "react";
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
        setError("A different private link was opened. Check report status again to view that report.");
        return;
      }
      window.history.replaceState(null, "", "/gift-status");
      setReceipt(result);
    }
    catch (error) { setError(error instanceof Error ? error.message : "Could not check the report."); }
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
  return <section className="panel prose"><h1>Your private report</h1><p>Demo - no real money. This link shows only the report associated with its private key. Never share it publicly.</p><p className="muted">Checking keeps only the random key in this tab&apos;s session storage so reloading works. Forget it before leaving a shared device; keep your original private link if you want to return.</p><div className="actions"><button className="button" disabled={busy} onClick={check}>{busy ? "Checking..." : "Check report status"}</button><button className="text-button" disabled={busy} onClick={forget}>Forget private key in this tab</button></div>{storageWarning && <p role="status" className="notice">{storageWarning}</p>}{error && <p role="alert" className="error-box">{error}</p>}{receipt && <div role="status"><h2>{receipt.status === "owner_confirmed" ? "Owner-confirmed demo report" : receipt.status.replaceAll("_", " ")}</h2><p>{formatINR(receipt.amountPaise)} toward {receipt.goalTitle}</p><p>Recipient label: {receipt.recipientLabel}</p><p>Reference: {receipt.id}</p><p>Owner confirmation is a manual declaration, never bank/provider verification. This is not a tax receipt.</p></div>}</section>;
}
