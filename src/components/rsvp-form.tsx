"use client";

import { CheckIcon, HeartIcon } from "./icons";
import { useState } from "react";
import { WeddingMark, WeddingFlourish, WeddingGarland } from "./wedding-mark";
import type { RsvpView } from "@/lib/guests";
import { formatArrival } from "@/lib/guests";
import { requestJson, RequestError } from "./client-api";
import { useRequestLock } from "./use-request-lock";

export function RsvpForm({ token, initial }: { token: string; initial: RsvpView }) {
  const [view, setView] = useState(initial);
  const [rsvp, setRsvp] = useState<"attending" | "not_attending" | "">(initial.rsvp === "pending" ? "" : initial.rsvp);
  const [arrival, setArrival] = useState(initial.expectedArrival ?? "");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const { busy, start, finish } = useRequestLock();

  const weddingDate = view.weddingDate
    ? new Intl.DateTimeFormat("en-IN", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${view.weddingDate}T00:00:00Z`))
    : null;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!start()) return;
    setError(""); setSaved(false);
    try {
      const next = await requestJson<RsvpView>(`/api/rsvp/${token}`, "POST", {
        rsvp, expectedArrival: rsvp === "attending" ? arrival || null : null
      });
      setView(next); setSaved(true);
    } catch (caught) { setError(caught instanceof RequestError ? caught.message : "Could not save your answer. Try again."); }
    finally { finish(); }
  }

  return (
    <article className="panel prose" aria-labelledby="rsvp-title">
      <header className="hero">
        <p className="eyebrow">Wedding invitation</p><WeddingFlourish /><WeddingGarland /><WeddingMark />
        <h1 id="rsvp-title">{view.displayNames}</h1>
        {weddingDate && <p className="date">{weddingDate}</p>}
        <p className="story">Hello {view.name}, we would love to celebrate with you. Will you join us for the big day?</p>
      </header>
      {!view.open ? <p role="status">RSVP for this wedding is closed. Please reach the couple directly for any changes.</p> : (
        <form onSubmit={save} aria-busy={busy}>
          <fieldset className="form-fields" disabled={busy}>
            <legend>Will you attend?</legend>
            <div className="actions">
              <button type="button" className={rsvp === "attending" ? "button" : "button secondary"} aria-pressed={rsvp === "attending"}
                onClick={() => { setRsvp("attending"); setSaved(false); }}>{rsvp === "attending" && <span className="rsvp-heart" aria-hidden="true"><HeartIcon /></span>}Yes, I&apos;ll be there</button>
              <button type="button" className={rsvp === "not_attending" ? "button" : "button secondary"} aria-pressed={rsvp === "not_attending"}
                onClick={() => { setRsvp("not_attending"); setSaved(false); }}>No, I can&apos;t make it</button>
            </div>
            {rsvp === "attending" && <>
              <label htmlFor="arrival">When do you expect to arrive? <span>(optional)</span></label>
              <input id="arrival" type="time" value={arrival} onChange={(event) => { setArrival(event.target.value); setSaved(false); }} />
              <small>This helps the couple plan. You can change it any time before the wedding.</small>
            </>}
            {rsvp && <div className="actions"><button className="button" disabled={busy} type="submit">{busy ? "Saving..." : "Save my answer"}</button></div>}
          </fieldset>
        </form>
      )}
      {error && <p role="alert" className="error">{error}</p>}
      {saved && <p role="status" className="rsvp-saved"><span className="saved-check" aria-hidden="true"><CheckIcon /></span>Guest details updated. Thank you, {view.name}!
        {view.rsvp === "attending" && view.expectedArrival ? ` The couple sees your expected arrival as ${formatArrival(view.expectedArrival)}.` : ""}</p>}
      <p className="privacy-note">Your answer is not listed publicly. Anyone holding this link can see and change your answer and arrival time, so keep it to yourself.</p>
    </article>
  );
}
