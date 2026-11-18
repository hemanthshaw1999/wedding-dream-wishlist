"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { OwnerWishlist, WishlistState } from "@/lib/wishlist";
import { en } from "@/lib/strings";
import { requestJson, RequestError } from "./client-api";
import { AuthPanel } from "./auth-panel";
import { authClient } from "./auth-client";

type Summary = { id: string; displayNames: string; slug: string; state: WishlistState };

export function OwnerWorkspace({ wishlists }: { wishlists: Summary[] | null }) {
  const router = useRouter();
  const [entered, setEntered] = useState(wishlists !== null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [names, setNames] = useState("");
  const [story, setStory] = useState("");
  const [slug, setSlug] = useState("");
  const [date, setDate] = useState("");
  const [expiry, setExpiry] = useState("");
  const [visibility, setVisibility] = useState("unlisted");
  const [goals, setGoals] = useState([{ title: "", description: "", target: "" }]);

  async function signOut() {
    setBusy(true); setError("");
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error("Sign-out failed. Retry before leaving a shared computer.");
      setEntered(false);
      router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not leave the demo."); }
    finally { setBusy(false); }
  }
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(""); setFields({});
    try {
      const result = await requestJson<OwnerWishlist>("/api/owner/wishlists", "POST", {
        displayNames: names, story, slug, weddingDate: date, expiresOn: expiry, visibility, goals
      });
      router.push(`/owner/${result.id}`);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not create the wishlist.");
      if (error instanceof RequestError) {
        setFields(error.fields);
        if (error.status === 401) setEntered(false);
      }
    } finally { setBusy(false); }
  }
  function updateGoal(index: number, key: "title" | "description" | "target", value: string) {
    setGoals(goals.map((goal, current) => current === index ? { ...goal, [key]: value } : goal));
  }
  function fieldError(key: string) {
    return fields[key] ? <span className="field-error" id={`error-${key}`}>{fields[key]}</span> : null;
  }

  return (
    <>
      <header className="page-title"><p className="eyebrow">Build a meaningful next chapter</p><h1>Your local workspace</h1></header>
      <section className="notice"><strong>{en.demo}</strong><p>{en.ownerWarning}</p><p>Separate accounts use self-hosted Better Auth, verification and recovery through a private local mailbox. Sessions expire after one hour.</p></section>
      {error && <div role="alert" className="error-box">{error}</div>}
      {!entered && <AuthPanel onSignedIn={() => { setEntered(true); setError(""); router.refresh(); }} />}
      {entered && (
        <div className="workspace-grid">
          <section className="panel" aria-labelledby="create-title">
            <h2 id="create-title">Create a wishlist</h2>
            <p className="muted">Save a private draft first. Preview before sharing. All fields are fictional.</p>
            <form onSubmit={create} aria-busy={busy}>
              <label htmlFor="names">Couple display names</label>
              <input id="names" autoComplete="off" maxLength={100} required value={names} onChange={(e) => setNames(e.target.value)} aria-invalid={Boolean(fields.displayNames)} aria-describedby={fields.displayNames ? "error-displayNames" : undefined} />
              {fieldError("displayNames")}
              <label htmlFor="story">Your story <span>(optional)</span></label>
              <textarea id="story" maxLength={2000} value={story} onChange={(e) => setStory(e.target.value)} />
              <div className="form-grid">
                <div><label htmlFor="wedding-date">Wedding date <span>(optional)</span></label><input id="wedding-date" type="date" min="1900-01-01" max="2200-12-31" value={date} onChange={(e) => setDate(e.target.value)} /></div>
                <div><label htmlFor="expiry">Available through <span>(optional, IST)</span></label><input id="expiry" type="date" min="1900-01-01" max="2200-12-31" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></div>
              </div>
              <label htmlFor="slug">Share slug</label>
              <input id="slug" required minLength={3} maxLength={60} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={slug} onChange={(e) => setSlug(e.target.value)} aria-invalid={Boolean(fields.slug)} aria-describedby="slug-hint" />
              <small id="slug-hint">3-60 lowercase letters, numbers and single hyphens. Fixed after creation in this slice.</small>
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
                  <input id={`title-${index}`} required maxLength={100} value={goal.title} onChange={(e) => updateGoal(index, "title", e.target.value)} />
                  <label htmlFor={`description-${index}`}>Description <span>(optional)</span></label>
                  <textarea id={`description-${index}`} maxLength={1000} value={goal.description} onChange={(e) => updateGoal(index, "description", e.target.value)} />
                  <label htmlFor={`target-${index}`}>Target amount (INR)</label>
                  <input id={`target-${index}`} inputMode="decimal" required value={goal.target} onChange={(e) => updateGoal(index, "target", e.target.value)} aria-invalid={Boolean(fields[`goals.${index}.target`])} aria-describedby={`target-hint-${index}`} />
                  <small id={`target-hint-${index}`}>For example 300000. Up to two decimal places. INR 0.01 to INR 1,00,00,000.</small>
                  {fieldError(`goals.${index}.target`)}
                  {goals.length > 1 && <button className="text-button" type="button" onClick={() => setGoals(goals.filter((_, current) => current !== index))}>Remove goal {index + 1}</button>}
                </fieldset>
              ))}
              <div className="actions">
                <button className="button secondary" type="button" disabled={goals.length >= 20 || busy} onClick={() => setGoals([...goals, { title: "", description: "", target: "" }])}>Add a goal</button>
                <button className="button" disabled={busy} type="submit">{busy ? "Saving..." : "Save draft and preview"}</button>
              </div>
            </form>
          </section>
          <aside className="panel" aria-labelledby="existing-title">
            <h2 id="existing-title">Saved wishlists</h2>
            {!wishlists?.length && <p>No wishlists yet. Create your first fictional draft.</p>}
            <ul className="wishlist-list">
              {wishlists?.map((wishlist) => <li key={wishlist.id}><Link href={`/owner/${wishlist.id}`}>{wishlist.displayNames}</Link><span className="pill">{wishlist.state}</span></li>)}
            </ul>
            <button type="button" className="button secondary" disabled={busy} onClick={signOut}>Sign out</button>
            <p className="muted">Leaving removes the session, not the persisted demo data.</p>
          </aside>
        </div>
      )}
    </>
  );
}
