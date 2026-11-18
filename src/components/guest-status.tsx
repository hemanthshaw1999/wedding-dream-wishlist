"use client";

import { useState } from "react";
import type { ClaimReceipt } from "@/lib/claims";
import { formatINR } from "@/lib/money";
import { requestJson } from "./client-api";

export function GuestStatus() {
  const [token, setToken] = useState("");
  const [receipt, setReceipt] = useState<ClaimReceipt | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function check() {
    setBusy(true); setError("");
    const key = token || window.location.hash.slice(1);
    setToken(key);
    window.history.replaceState(null, "", "/gift-status");
    try { setReceipt(await requestJson<ClaimReceipt>("/api/guest/status", "POST", { token: key })); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not check the report."); }
    finally { setBusy(false); }
  }
  return <section className="panel prose"><h1>Your private report</h1><p>Demo - no real money. This link shows only the report associated with its private key. Never share it publicly.</p><button className="button" disabled={busy} onClick={check}>{busy ? "Checking..." : "Check report status"}</button>{error && <p role="alert" className="error-box">{error}</p>}{receipt && <div role="status"><h2>{receipt.status === "owner_confirmed" ? "Owner-confirmed demo report" : receipt.status.replaceAll("_", " ")}</h2><p>{formatINR(receipt.amountPaise)} toward {receipt.goalTitle}</p><p>Recipient label: {receipt.recipientLabel}</p><p>Reference: {receipt.id}</p><p>Owner confirmation is a manual declaration, never bank/provider verification. This is not a tax receipt.</p></div>}</section>;
}
