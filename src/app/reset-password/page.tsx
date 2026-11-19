"use client";

import Link from "next/link";
import { useState } from "react";
import { authClient } from "@/components/auth-client";
import { PasswordInput } from "@/components/password-input";
import { useRequestLock } from "@/components/use-request-lock";

export default function ResetPassword() {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const { busy, start, finish } = useRequestLock();
  const [complete, setComplete] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!start()) return;
    setMessage(""); setError("");
    try {
      const token = new URL(window.location.href).searchParams.get("token");
      if (!token) { setError("Recovery link is missing or invalid. Request a new one."); return; }
      const result = await authClient.resetPassword({ token, newPassword: password });
      if (result.error) { setError("Recovery link is invalid, expired or already used. Request a new one."); return; }
      setPassword(""); setComplete(true);
      window.history.replaceState(null, "", "/reset-password");
      setMessage("Password updated. Existing sessions were revoked. Sign in again.");
    } catch { setError("Could not reach the server. Retry when connected."); }
    finally { finish(); }
  }
  return <section className="panel auth-panel"><h1>Reset password</h1><p>Choose a unique password. After updating it, sign in again on each device.</p>{!complete && <form onSubmit={submit} aria-busy={busy}><label htmlFor="new-password">New password (12-128 characters)</label><PasswordInput id="new-password" disabled={busy} minLength={12} maxLength={128} required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /><div className="actions"><button className="button" disabled={busy}>{busy ? "Updating..." : "Update password"}</button></div></form>}{error && <p role="alert" className="error-box">{error} <Link href="/owner?mode=recover">Request a new recovery link</Link></p>}<p role="status">{message}</p><Link href="/owner">Return to sign in</Link></section>;
}
