"use client";

import { useEffect, useRef, useState } from "react";
import { authClient } from "./auth-client";
import { PasswordInput } from "./password-input";
import { useRequestLock } from "./use-request-lock";

type Mode = "sign-in" | "sign-up" | "recover" | "verify";
export type AuthEntry = "sign-in" | "sign-up" | "recover" | "verification-return" | "verification-error";

export function AuthPanel({ onSignedIn, demo = true, entry = "sign-in", returnTo = "/owner" }: {
  onSignedIn: (userId: string) => void; demo?: boolean; entry?: AuthEntry; returnTo?: string;
}) {
  const [mode, setMode] = useState<Mode>(entry === "verification-return" || entry === "verification-error" ? "sign-in" : entry);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { busy, start, finish } = useRequestLock();
  const [error, setError] = useState("");
  const [linkError, setLinkError] = useState(entry === "verification-error");
  const [message, setMessage] = useState(entry === "verification-return" ? "Ready to sign in? Use your verified email and password." : "");
  const titleRef = useRef<HTMLHeadingElement>(null);
  const previousMode = useRef(mode);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const callbackURL = `/owner?${new URLSearchParams({ verification: "returned", next: returnTo })}`;
  const deliveryMessage = demo
    ? "If eligible, a verification message is in the private local mailbox. No email was sent."
    : "If eligible, a verification message has been queued. Check your inbox and spam folder; delivery may be delayed.";
  useEffect(() => {
    if (previousMode.current !== mode) titleRef.current?.focus();
    previousMode.current = mode;
  }, [mode]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  function changeMode(next: Mode) {
    setMode(next); setPassword(""); setError(""); setMessage(""); setLinkError(false);
  }
  async function resend() {
    if (!start()) return;
    setError(""); setMessage(""); setLinkError(false);
    try {
      const result = await authClient.sendVerificationEmail({ email: email.trim(), callbackURL });
      if (result.error) { setError("Verification could not be requested. Wait and try again."); return; }
      setMessage(deliveryMessage);
    } catch { setError("Verification could not reach the server. Check your connection and retry."); }
    finally { finish(); }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!start()) return;
    setError(""); setMessage("");
    try {
      if (mode === "sign-up") {
        const result = await authClient.signUp.email({ name, email: email.trim(), password, callbackURL });
        if (result.error) { setError(demo ? "Check your registration details and try again. Use a fictional @example.test address and a 12-128 character password." : "Check your registration details and try again. Use a valid email address and a 12-128 character password."); return; }
        setPassword("");
        setMode("verify"); setMessage(deliveryMessage);
      } else if (mode === "recover") {
        const result = await authClient.requestPasswordReset({ email: email.trim(), redirectTo: "/reset-password" });
        if (result.error) { setError("Recovery could not be requested. Wait and try again."); return; }
        setMessage(demo ? "If an eligible account exists, a recovery link is in the private local mailbox. No email was sent." : "If an eligible account exists, a recovery message has been queued. Delivery may be delayed; check your inbox and spam folder.");
      } else {
        const result = await authClient.signIn.email({ email: email.trim(), password, rememberMe: false });
        if (result.error?.code === "EMAIL_NOT_VERIFIED") {
          setPassword(""); setMode("verify");
          setMessage("Open your verification message before signing in, or request another one below.");
          return;
        }
        if (result.error || !result.data?.user.id) { setError("Sign-in was not completed. Check your credentials, verification status, or try again later."); return; }
        setPassword("");
        onSignedIn(result.data.user.id);
      }
    } catch { setError("Authentication could not reach the server. Your email stays in this form; retry when connected."); }
    finally { finish(); }
  }
  return (
    <section className="panel auth-panel" aria-labelledby="auth-title">
      <p className="eyebrow">{mode === "verify" ? "Next / Verify your email" : "Your private workspace"}</p>
      <h2 ref={titleRef} tabIndex={-1} id="auth-title">{mode === "sign-in" ? "Sign in" : mode === "sign-up" ? "Create your own account" : mode === "verify" ? "Check your verification message" : "Recover account"}</h2>
      <p>{mode === "sign-in" ? "Welcome back. Your drafts and guest reports stay private." : mode === "sign-up" ? "Create an account, verify your email, then sign in to start your first wishlist." : mode === "recover" ? "Request a private link to choose a new password." : <>Verify <strong className="break-text">{email}</strong>, then return here to sign in. Already verified? Continue below.</>}</p>
      {mode === "verify" && <div className="verification-next">
        <button className="button" disabled={busy} onClick={() => changeMode("sign-in")}>Continue to sign in</button>
        <button className="text-button" disabled={busy} onClick={resend}>{busy ? "Requesting..." : "Resend verification message"}</button>
      </div>}
      {demo && <div className="demo-hint">Local demo: fictional <code>@example.test</code> addresses only. No real email is sent.<details><summary>How to get your private verification or recovery link</summary><p>Run <code>npm run auth:mailbox</code> in the private project terminal and open your link on this computer. Never share that link.</p></details></div>}
      {linkError && <p className="notice">This verification link could not be used. It may have expired. Enter your email below and request another verification message.</p>}
      {mode !== "verify" && <form onSubmit={submit} aria-busy={busy}>
        <fieldset className="form-fields" disabled={busy} aria-label="Account details">
        {mode === "sign-up" && <><label htmlFor="account-name">Your display name</label><input id="account-name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} autoComplete="nickname" /></>}
        <label htmlFor="account-email">{demo ? "Account email (fictional)" : "Account email"}</label>
        <input id="account-email" required type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={demo ? "your-name@example.test" : "you@example.com"} maxLength={254} />
        {mode !== "recover" && <><label htmlFor="account-password">Password</label><PasswordInput key={mode} id="account-password" required minLength={mode === "sign-up" ? 12 : 1} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "sign-up" ? "new-password" : "current-password"} aria-describedby={mode === "sign-up" ? "password-hint" : undefined} />{mode === "sign-up" && <small id="password-hint">12-128 characters. Use a unique password.</small>}</>}
        </fieldset>
        <button className="button" type="submit" disabled={busy}>{busy ? "Please wait..." : mode === "sign-up" ? "Create account" : mode === "recover" ? "Request recovery link" : "Sign in"}</button>
      </form>}
      {error && <p ref={errorRef} tabIndex={-1} role="alert" className="error-box">{error}</p>}
      <p role="status">{message}</p>
      <div className="actions">
        {mode !== "sign-in" && mode !== "verify" && <button className="text-button" disabled={busy} onClick={() => changeMode("sign-in")}>Back to sign in</button>}
        {mode !== "sign-up" && <button className="text-button" disabled={busy} onClick={() => changeMode("sign-up")}>{mode === "verify" ? "Use another email" : "Create an account"}</button>}
        {mode !== "recover" && mode !== "verify" && <button className="text-button" disabled={busy} onClick={() => changeMode("recover")}>Forgot password</button>}
        {mode === "sign-in" && <button className="text-button" disabled={busy || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())} onClick={() => changeMode("verify")}>Need a verification message?</button>}
      </div>
      <p className="muted">Never share passwords or authentication links. No Google or Microsoft account is needed.</p>
    </section>
  );
}
