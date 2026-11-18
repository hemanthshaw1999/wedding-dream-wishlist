"use client";

import { useState } from "react";
import { authClient } from "./auth-client";

export function AuthPanel({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<"sign-in" | "sign-up" | "recover">("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      if (mode === "sign-up") {
        const result = await authClient.signUp.email({ name, email, password, callbackURL: "/owner" });
        if (result.error) { setError("Check your registration details and try again. Use a fictional @example.test address and a 12-128 character password."); return; }
        setPassword("");
        setMessage("If registration is eligible, a verification message is in the private local mailbox. Run npm run auth:mailbox in the project terminal. No email was sent. After verifying, sign in.");
      } else if (mode === "recover") {
        const result = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
        if (result.error) { setError("Recovery could not be requested. Wait and try again."); return; }
        setMessage("If an eligible account exists, a recovery link is in the private local mailbox. No email was sent.");
      } else {
        const result = await authClient.signIn.email({ email, password, rememberMe: false });
        if (result.error) { setError("Sign-in was not completed. Check your credentials, verification status, or try again later."); return; }
        setPassword("");
        onSignedIn();
      }
    } catch { setError("Authentication could not reach the local server. Your email stays in this form; retry when connected."); }
    finally { setBusy(false); }
  }
  return (
    <section className="panel auth-panel" aria-labelledby="auth-title">
      <h2 id="auth-title">{mode === "sign-in" ? "Sign in" : mode === "sign-up" ? "Create your own account" : "Recover account"}</h2>
      <p>Self-hosted Better Auth. No Google, Microsoft or hosted identity account is required. Only fictional <code>@example.test</code> addresses are accepted locally.</p>
      <form onSubmit={submit} aria-busy={busy}>
        {mode === "sign-up" && <><label htmlFor="account-name">Your display name</label><input id="account-name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} autoComplete="nickname" /></>}
        <label htmlFor="account-email">Account email (fictional)</label>
        <input id="account-email" required type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="your-name@example.test" maxLength={100} />
        {mode !== "recover" && <><label htmlFor="account-password">Password</label><input id="account-password" required type="password" minLength={mode === "sign-up" ? 12 : 1} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "sign-up" ? "new-password" : "current-password"} /></>}
        {error && <p role="alert" className="error-box">{error}</p>}
        <p role="status">{message}</p>
        <button className="button" type="submit" disabled={busy}>{busy ? "Please wait..." : mode === "sign-up" ? "Create account" : mode === "recover" ? "Request recovery link" : "Sign in"}</button>
      </form>
      <div className="actions">
        {mode !== "sign-in" && <button className="text-button" onClick={() => { setMode("sign-in"); setError(""); }}>Back to sign in</button>}
        {mode !== "sign-up" && <button className="text-button" onClick={() => { setMode("sign-up"); setError(""); }}>Create an account</button>}
        {mode !== "recover" && <button className="text-button" onClick={() => { setMode("recover"); setError(""); }}>Forgot password</button>}
      </div>
      <p className="muted">Verification links are private credentials. Never paste passwords or mailbox links into chat. Local mailbox access is not suitable for a publicly hosted app.</p>
    </section>
  );
}
