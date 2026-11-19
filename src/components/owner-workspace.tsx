"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { OwnerWishlist, WishlistState } from "@/lib/wishlist";
import { requestJson, RequestError } from "./client-api";
import { AuthPanel, type AuthEntry } from "./auth-panel";
import { authClient } from "./auth-client";
import { useRequestLock } from "./use-request-lock";

type Summary = { id: string; displayNames: string; slug: string; state: WishlistState };

export function OwnerWorkspace({ wishlists, session, authDemo = true, entry, returnTo = "/owner" }: {
  wishlists: Summary[] | null; session: { ownerId: string | null }; authDemo?: boolean; entry?: AuthEntry; returnTo?: string;
}) {
  const router = useRouter();
  const [authChange, setAuthChange] = useState<{ source: typeof session; ownerId: string | null; exiting?: boolean } | null>(null);
  const activeOwner = authChange?.source === session ? authChange.ownerId : session.ownerId;
  const entered = activeOwner !== null;
  const serverSettled = activeOwner === session.ownerId;
  const visibleWishlists = serverSettled ? wishlists : null;
  const exiting = authChange?.source === session && authChange.exiting;
  const draftOwner = useRef(session.ownerId);
  const [refreshing, startRefresh] = useTransition();
  const { busy, start, finish } = useRequestLock();
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [names, setNames] = useState("");
  const [story, setStory] = useState("");
  const [slug, setSlug] = useState("");
  const [date, setDate] = useState("");
  const [expiry, setExpiry] = useState("");
  const [visibility, setVisibility] = useState("unlisted");
  const [goals, setGoals] = useState([{ title: "", description: "", target: "" }]);
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  function clearDraft() {
    setNames(""); setStory(""); setSlug(""); setDate(""); setExpiry(""); setVisibility("unlisted");
    setGoals([{ title: "", description: "", target: "" }]); setFields({});
  }
  function signedIn(ownerId: string) {
    if (draftOwner.current && draftOwner.current !== ownerId) clearDraft();
    draftOwner.current = ownerId;
    setAuthChange({ source: session, ownerId }); setError("");
    if (returnTo !== "/owner") router.replace(returnTo);
    else startRefresh(() => router.refresh());
  }

  async function signOut() {
    if (!start()) return;
    setError("");
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error("Sign-out failed. Retry before leaving a shared computer.");
      clearDraft(); draftOwner.current = null;
      setAuthChange({ source: session, ownerId: null, exiting: true });
      startRefresh(() => router.refresh());
    } catch (error) { setError(error instanceof Error ? error.message : "Could not leave the demo."); }
    finally { finish(); }
  }
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!start()) return;
    setError(""); setFields({});
    try {
      const result = await requestJson<OwnerWishlist>("/api/owner/wishlists", "POST", {
        displayNames: names, story, slug, weddingDate: date, expiresOn: expiry, visibility, goals
      });
      router.push(`/owner/${result.id}`);
    } catch (error) {
      const unknown = error instanceof RequestError && (error.status === 0 || error.status >= 500 || error.status === 201);
      setError(unknown ? "The save outcome is unknown. Refresh saved wishlists before retrying or choosing another slug. Your form is preserved."
        : error instanceof Error ? error.message : "Could not create the wishlist.");
      if (error instanceof RequestError) {
        setFields(error.fields);
        if (error.status === 401) setAuthChange({ source: session, ownerId: null });
      }
    } finally { finish(); }
  }
  function updateGoal(index: number, key: "title" | "description" | "target", value: string) {
    setGoals(goals.map((goal, current) => current === index ? { ...goal, [key]: value } : goal));
  }
  function fieldError(key: string) {
    return fields[key] ? <span className="field-error" id={`error-${key}`}>{fields[key]}</span> : null;
  }

  return (
    <>
      <header className="page-title"><p className="eyebrow">Build a meaningful next chapter</p><h1>Your wishlist workspace</h1><p className="muted">A private place for your story, dreams and guest reports. Use fictional details only in this demo.</p></header>
      {error && <div ref={errorRef} tabIndex={-1} role="alert" className="error-box">{error}{!entered && <p>Your unsaved draft is kept here. Sign in to the same account to continue.</p>}</div>}
      {!entered && exiting && <p role="status">Signed out. Loading sign-in... <button type="button" className="text-button" onClick={() => window.location.reload()}>Reload sign-in</button></p>}
      {!entered && !exiting && <div className="onboarding-grid">
        <aside className="onboarding-intro">
          <p className="eyebrow">From your first idea to a shared story</p>
          <h2>Make room for what matters.</h2>
          <ol className="journey-steps"><li><strong>Create and verify</strong><span>Use your own account. Verification protects access to your workspace.</span></li><li><strong>Start with a private draft</strong><span>Add your story and goals. Nothing is shared until you publish.</span></li><li><strong>Preview, then share</strong><span>Guests can explore without an account. Payments remain disabled.</span></li></ol>
          <p className="muted">Demo - no real money. No bank details, screenshots or real personal information. Sessions expire after one hour.</p>
        </aside>
        <AuthPanel demo={authDemo} entry={entry} returnTo={returnTo} onSignedIn={signedIn} />
      </div>}
      {entered && (
        <div className="workspace-grid">
          <section className="panel" aria-labelledby="create-title">
            <h2 id="create-title">Create a wishlist</h2>
            <p className="muted">Save a private draft first. Preview before sharing. All fields are fictional.</p>
            <form onSubmit={create} aria-busy={busy}>
              <fieldset className="form-fields" disabled={busy || !serverSettled} aria-label="Wishlist details">
              <label htmlFor="names">Couple display names</label>
              <input id="names" autoComplete="off" maxLength={100} required value={names} onChange={(e) => setNames(e.target.value)} aria-invalid={Boolean(fields.displayNames)} aria-describedby={fields.displayNames ? "error-displayNames" : undefined} />
              {fieldError("displayNames")}
              <label htmlFor="story">Your story <span>(optional)</span></label>
              <textarea id="story" maxLength={2000} value={story} onChange={(e) => setStory(e.target.value)} aria-invalid={Boolean(fields.story)} aria-describedby={fields.story ? "error-story" : undefined} />{fieldError("story")}
              <div className="form-grid">
                <div><label htmlFor="wedding-date">Wedding date <span>(optional)</span></label><input id="wedding-date" type="date" min="1900-01-01" max="2200-12-31" value={date} onChange={(e) => setDate(e.target.value)} aria-invalid={Boolean(fields.weddingDate)} aria-describedby={fields.weddingDate ? "error-weddingDate" : undefined} />{fieldError("weddingDate")}</div>
                <div><label htmlFor="expiry">Available through <span>(optional, IST)</span></label><input id="expiry" type="date" min="1900-01-01" max="2200-12-31" value={expiry} onChange={(e) => setExpiry(e.target.value)} aria-invalid={Boolean(fields.expiresOn)} aria-describedby={fields.expiresOn ? "error-expiresOn" : undefined} />{fieldError("expiresOn")}</div>
              </div>
              <label htmlFor="slug">Share slug</label>
              <input id="slug" required minLength={3} maxLength={60} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={slug} onChange={(e) => setSlug(e.target.value)} aria-invalid={Boolean(fields.slug)} aria-describedby={`slug-hint${fields.slug ? " error-slug" : ""}`} />
              <small id="slug-hint">The end of your guest link, such as tara-and-arjun. 3-60 lowercase letters, numbers and single hyphens. Cannot be changed after saving.</small>
              {fieldError("slug")}
              <label htmlFor="visibility">Visibility after publishing</label>
              <select id="visibility" value={visibility} onChange={(e) => setVisibility(e.target.value)}>
                <option value="unlisted">Unlisted - anyone with the link</option>
                <option value="public">Public - anonymous viewing allowed</option>
                <option value="private">Private - owner preview only</option>
              </select>
              <small>No indexing or public directory in this demo. Unlisted links are shareable, not passwords.</small>
              <h3>Your goals</h3>
              {goals.map((goal, index) => (
                <fieldset key={index}>
                  <legend>Goal {index + 1}</legend>
                  <label htmlFor={`title-${index}`}>Goal title</label>
                  <input id={`title-${index}`} required maxLength={100} value={goal.title} onChange={(e) => updateGoal(index, "title", e.target.value)} aria-invalid={Boolean(fields[`goals.${index}.title`])} aria-describedby={fields[`goals.${index}.title`] ? `error-goals.${index}.title` : undefined} />{fieldError(`goals.${index}.title`)}
                  <label htmlFor={`description-${index}`}>Description <span>(optional)</span></label>
                  <textarea id={`description-${index}`} maxLength={1000} value={goal.description} onChange={(e) => updateGoal(index, "description", e.target.value)} aria-invalid={Boolean(fields[`goals.${index}.description`])} aria-describedby={fields[`goals.${index}.description`] ? `error-goals.${index}.description` : undefined} />{fieldError(`goals.${index}.description`)}
                  <label htmlFor={`target-${index}`}>Target amount (INR)</label>
                  <input id={`target-${index}`} inputMode="decimal" required value={goal.target} onChange={(e) => updateGoal(index, "target", e.target.value)} aria-invalid={Boolean(fields[`goals.${index}.target`])} aria-describedby={`target-hint-${index}${fields[`goals.${index}.target`] ? ` error-goals.${index}.target` : ""}`} />
                  <small id={`target-hint-${index}`}>For example 300000. Up to two decimal places. INR 0.01 to INR 1,00,00,000.</small>
                  {fieldError(`goals.${index}.target`)}
                  {goals.length > 1 && <button className="text-button" type="button" onClick={() => setGoals(goals.filter((_, current) => current !== index))}>Remove goal {index + 1}</button>}
                </fieldset>
              ))}
              <div className="actions">
                <button className="button secondary" type="button" disabled={goals.length >= 20 || busy} onClick={() => setGoals([...goals, { title: "", description: "", target: "" }])}>Add a goal</button>
                <button className="button" disabled={busy} type="submit">{busy ? "Saving..." : "Save draft and preview"}</button>
              </div>
              </fieldset>
            </form>
          </section>
          <aside className="panel" aria-labelledby="existing-title" aria-busy={visibleWishlists === null}>
            <h2 id="existing-title">Saved wishlists</h2>
            {visibleWishlists === null ? <p role="status">Loading saved wishlists...</p> : !visibleWishlists.length && <p>No wishlists yet. Create your first fictional draft.</p>}
            <ul className="wishlist-list">
              {visibleWishlists?.map((wishlist) => <li key={wishlist.id}><Link href={`/owner/${wishlist.id}`}>{wishlist.displayNames}</Link><span className="pill">{wishlist.state}</span></li>)}
            </ul>
            <div className="actions"><button type="button" className="text-button" disabled={busy || refreshing || !serverSettled} onClick={() => startRefresh(() => router.refresh())}>{refreshing ? "Refreshing..." : "Refresh saved wishlists"}</button></div>
            <button type="button" className="button secondary" disabled={busy || refreshing || !serverSettled} onClick={signOut}>Sign out</button>
            <p className="muted">Signing out clears unsaved form details on this page. Saved wishlists stay in your account.</p>
          </aside>
        </div>
      )}
    </>
  );
}
