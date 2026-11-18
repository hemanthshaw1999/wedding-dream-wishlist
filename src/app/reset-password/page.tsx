"use client";

import Link from "next/link";
import { useState } from "react";
import { authClient } from "@/components/auth-client";

export default function ResetPassword() {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setMessage("");
    try {
      const token = new URL(window.location.href).searchParams.get("token");
      if (!token) { setMessage("Recovery link is missing or invalid. Request a new one."); return; }
      const result = await authClient.resetPassword({ token, newPassword: password });
      if (result.error) { setMessage("Recovery link is invalid, expired or already used. Request a new one."); return; }
      setPassword(""); setComplete(true);
      window.history.replaceState(null, "", "/reset-password");
      setMessage("Password updated. Existing sessions were revoked. Sign in again.");
    } catch { setMessage("Could not reach the local server. Retry when connected."); }
    finally { setBusy(false); }
  }
  return <section className="panel auth-panel"><h1>Reset password</h1>{!complete && <form onSubmit={submit}><label htmlFor="new-password">New password (12-128 characters)</label><input id="new-password" type="password" minLength={12} maxLength={128} required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /><div className="actions"><button className="button" disabled={busy}>Update password</button></div></form>}<p role="status">{message}</p><Link href="/owner">Return to sign in</Link></section>;
}
