"use client";

import { useEffect, useRef, useState } from "react";
import { CloseIcon, CopyIcon, DotsIcon, ShareIcon } from "./icons";
import type { OwnerWishlist } from "@/lib/wishlist";
import type { OwnerGuestList } from "@/lib/guests";
import { formatArrival } from "@/lib/guests";
import { requestJson, RequestError } from "./client-api";
import { useRequestLock } from "./use-request-lock";

type ListResponse = OwnerGuestList & { invitePath?: string };
type BulkResponse = OwnerGuestList & { added: { name: string; invitePath: string }[]; duplicates: string[] };

export function OwnerGuests({ wishlist, initial, origin }: { wishlist: OwnerWishlist; initial: OwnerGuestList; origin: string }) {
  const locked = wishlist.state === "archived";
  const [list, setList] = useState(initial);
  const [invites, setInvites] = useState<Record<string, string>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [name, setName] = useState("");
  const [bulkNames, setBulkNames] = useState("");
  const [bulkNotice, setBulkNotice] = useState<{ text: string; links: string } | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [recording, setRecording] = useState<{ id: string; name: string; rsvp: string; arrival: string; previousUpdatedAt: string | null } | null>(null);
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);
  const recordRef = useRef<HTMLSelectElement>(null);
  const recordingId = recording?.id;
  useEffect(() => { if (recordingId) recordRef.current?.focus(); else returnFocusRef.current?.focus(); }, [recordingId]);
  const [sourceNote, setSourceNote] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const { busy, start, finish } = useRequestLock();

  function apply(response: ListResponse, guestId?: string) {
    const { invitePath, ...rest } = response;
    setList(rest);
    if (invitePath && guestId) setInvites((current) => ({ ...current, [guestId]: invitePath }));
  }
  function newestGuest(before: string[], after: OwnerGuestList) {
    return after.guests.find((guest) => !before.includes(guest.id))?.id;
  }
  function inviteUrl(guestId: string) {
    const path = invites[guestId];
    return path ? `${origin}${path}` : null;
  }
  function shareText(guestName: string, url: string) {
    return `You are invited to ${wishlist.displayNames}'s wedding. Please tell them if you can come through your private RSVP link: ${url}`;
  }
  function reminderText(guestName: string, url: string) {
    return `A gentle reminder about ${wishlist.displayNames}'s wedding - please let them know if you can come, it takes a few seconds: ${url}`;
  }
  async function copyText(text: string, done: string) {
    try { await navigator.clipboard.writeText(text); setMessage(done); }
    catch { setError("Copy failed. Select the text and copy it manually."); }
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!start()) return;
    setError(""); setMessage("");
    try {
      const before = list.guests.map((guest) => guest.id);
      const response = await requestJson<ListResponse>(`/api/owner/wishlists/${wishlist.id}/guests`, "POST", { name });
      apply(response, newestGuest(before, response));
      setName("");
      setMessage("Guest added. Share their private link below - it shows only once.");
    } catch (caught) { setError(caught instanceof RequestError ? caught.message : "Could not add the guest."); }
    finally { finish(); }
  }
  async function addBulk(event: React.FormEvent) {
    event.preventDefault();
    if (!start()) return;
    setError(""); setMessage(""); setBulkNotice(null);
    try {
      const names = bulkNames.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const response = await requestJson<BulkResponse>(`/api/owner/wishlists/${wishlist.id}/guests`, "POST", { names });
      const { added, duplicates, ...rest } = response;
      setList(rest);
      const lines: string[] = [];
      const additions: Record<string, string> = {};
      for (const entry of added) {
        const guest = rest.guests.find((item) => item.name.toLowerCase() === entry.name.toLowerCase());
        if (guest) additions[guest.id] = entry.invitePath;
        lines.push(`${entry.name}: ${origin}${entry.invitePath}`);
      }
      setInvites((current) => ({ ...current, ...additions }));
      setBulkNames("");
      setBulkOpen(false);
      setBulkNotice({
        text: `${added.length} guest${added.length === 1 ? "" : "s"} added. Share each guest their own link below - links show only once.` +
          (duplicates.length ? ` Skipped, already on the list: ${duplicates.join(", ")}.` : ""),
        links: lines.join("\n")
      });
    } catch (caught) { setError(caught instanceof RequestError ? caught.message : "Could not add the guests."); }
    finally { finish(); }
  }

  async function remove(guestId: string, guestName: string) {
    if (!window.confirm(`Remove ${guestName} from the guest list? Their RSVP link stops working.`)) return;
    if (!start()) return;
    setError(""); setMessage("");
    try {
      setList(await requestJson<OwnerGuestList>(`/api/owner/wishlists/${wishlist.id}/guests/${guestId}`, "DELETE"));
      setInvites((current) => { const next = { ...current }; delete next[guestId]; return next; });
      setMessage("Guest removed.");
    } catch (caught) { setError(caught instanceof RequestError ? caught.message : "Could not remove the guest."); }
    finally { finish(); }
  }
  async function resetInvite(guestId: string) {
    if (!start()) return;
    setError(""); setMessage("");
    try {
      apply(await requestJson<ListResponse>(`/api/owner/wishlists/${wishlist.id}/guests/${guestId}/invite`, "POST", {}), guestId);
      setMessage("New private link created. The previous link no longer works - share the new one.");
    } catch (caught) { setError(caught instanceof RequestError ? caught.message : "Could not reset the link."); }
    finally { finish(); }
  }
  async function copy(guestId: string) {
    const url = inviteUrl(guestId);
    if (!url) return;
    try { await navigator.clipboard.writeText(url); setMessage("Private RSVP link copied."); }
    catch { setError("Copy failed. Select and copy the link text manually."); }
  }

  async function refreshGuests() {
    if (!start()) return;
    setError(""); setMessage("");
    try { setList(await requestJson<OwnerGuestList>(`/api/owner/wishlists/${wishlist.id}/guests`, "GET")); setRecording(null); setMessage("Guest list refreshed."); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not refresh guests."); }
    finally { finish(); }
  }
  async function recordAnswer(event: React.FormEvent) {
    event.preventDefault();
    if (!recording || !start()) return;
    setError(""); setMessage("");
    try {
      setList(await requestJson<OwnerGuestList>(`/api/owner/wishlists/${wishlist.id}/guests/${recording.id}`, "PATCH", {
        rsvp: recording.rsvp, expectedArrival: recording.rsvp === "attending" ? recording.arrival || null : null,
        previousUpdatedAt: recording.previousUpdatedAt, reason: sourceNote
      }));
      setOpen((current) => ({ ...current, [recording.id]: false }));
      setRecording(null); setSourceNote(""); setMessage("Answer saved by you. The guest can still update it through their link.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not record the answer."); }
    finally { finish(); }
  }

  const statusLabel: Record<string, string> = { pending: "Awaiting response", attending: "Confirmed", not_attending: "Not attending" };
  const answered = list.summary.attending + list.summary.notAttending;

  return (
    <section id="guest-list" className="panel" aria-labelledby="guests-title">
      <p className="eyebrow">Your favourite people</p>
      <h2 id="guests-title">Guest list and RSVP</h2>
      <p className="counts-line"><strong>{list.summary.invited} invited</strong> · {list.summary.attending} confirmed · {list.summary.notAttending} not attending · {list.summary.awaiting} awaiting</p>
      {list.summary.invited > 0 && <progress value={answered} max={list.summary.invited} aria-label={`Responses received: ${answered} of ${list.summary.invited}`} />}
      {locked ? <p>This wishlist is archived; its guest list is read-only.</p> : <>
        <div className="actions">
          <button type="button" className="button" aria-expanded={addOpen}
            onClick={() => { setAddOpen(!addOpen); if (addOpen) setBulkOpen(false); setError(""); }}>Add guest</button>
        </div>
        {addOpen && <form onSubmit={add}>
          <label htmlFor="guest-name">Guest name</label>
          <input id="guest-name" maxLength={100} required value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" />
          <div className="actions">
            <button className="button secondary" disabled={busy} type="submit">Add</button>
            <button type="button" className="text-button" aria-expanded={bulkOpen}
              onClick={() => { setBulkOpen(!bulkOpen); setError(""); }}>{bulkOpen ? "Hide bulk add" : "Add many guests"}</button>
          </div>
        </form>}
        {addOpen && bulkOpen && <form onSubmit={addBulk}>
          <label htmlFor="bulk-guests">Add many guests <span>(one name per line)</span></label>
          <textarea id="bulk-guests" value={bulkNames} onChange={(event) => setBulkNames(event.target.value)}
            placeholder={"Aunt Meena\nRavi Kumar\nSana Sheikh"} />
          <div className="actions"><button className="button secondary" disabled={busy || !bulkNames.trim()} type="submit">Add all</button></div>
        </form>}
      </>}
      {bulkNotice && <div className="notice compact" role="status">
        <p>{bulkNotice.text}</p>
        <div className="actions"><button type="button" className="button secondary"
          onClick={() => copyText(bulkNotice.links, "All invite links copied. Share each guest their own line, for example on WhatsApp.")}><CopyIcon />Copy all invite links</button></div>
        <button type="button" className="dismiss" aria-label="Dismiss" onClick={() => setBulkNotice(null)}><CloseIcon /></button>
      </div>}
      {error && <p role="alert" className="error">{error}</p>}
      {message && <p role="status">{message}</p>}
      {recording && !locked && <form className="host-rsvp-form" onSubmit={recordAnswer} aria-label={`Record answer for ${recording.name}`}>
        <fieldset disabled={busy}><legend>Record answer for {recording.name}</legend>
          <p className="muted">For a reply shared by phone or in person. This changes the guest&apos;s RSVP, not their gift.</p>
          <label htmlFor="host-rsvp-answer">Guest&apos;s answer</label><select ref={recordRef} id="host-rsvp-answer" required value={recording.rsvp} onChange={(event) => setRecording({ ...recording, rsvp: event.target.value })}><option value="" disabled>Choose an answer</option><option value="attending">Attending</option><option value="not_attending">Not attending</option></select>
          {recording.rsvp === "attending" && <><label htmlFor="host-rsvp-arrival">Expected arrival (optional)</label><input id="host-rsvp-arrival" type="time" value={recording.arrival} onChange={(event) => setRecording({ ...recording, arrival: event.target.value })} /></>}
          <label htmlFor="host-rsvp-source">Source note</label><input id="host-rsvp-source" required minLength={3} maxLength={200} placeholder="Phone call with guest" value={sourceNote} onChange={(event) => setSourceNote(event.target.value)} /><small>Saved in the owner audit record. No private details needed.</small>
          <div className="actions"><button className="button" type="submit">Save guest answer</button><button className="text-button" type="button" onClick={() => setRecording(null)}>Cancel</button></div>
        </fieldset>
      </form>}
      {list.guests.length > 0 && <ul className="guest-rows">
        {list.guests.map((guest) => {
          const url = inviteUrl(guest.id);
          const expanded = Boolean(open[guest.id]);
          return (
            <li key={guest.id}>
              <span className="row-main">
                <strong>{guest.name}</strong> <span className="pill">{statusLabel[guest.rsvp]}</span>
                {guest.rsvp === "attending" && guest.expectedArrival && <span className="row-detail">arriving around {formatArrival(guest.expectedArrival)}</span>}
                {guest.rsvpUpdatedAt && <span className="row-detail">updated {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(guest.rsvpUpdatedAt))} IST</span>}
              </span>
              {!locked && <span className="row-actions">
                {url
                  ? <a className="icon-button" target="_blank" rel="noopener noreferrer" aria-label={`Share on WhatsApp: ${guest.name}`}
                    href={`https://wa.me/?text=${encodeURIComponent(shareText(guest.name, url))}`}><ShareIcon /></a>
                  : <button type="button" className="text-button" disabled={busy} onClick={() => resetInvite(guest.id)}>Reset link</button>}
                <button type="button" className="icon-button" aria-expanded={expanded} aria-label={`More actions for ${guest.name}`}
                  onClick={(event) => { returnFocusRef.current = event.currentTarget; setOpen((current) => ({ ...current, [guest.id]: !expanded })); }}><DotsIcon /></button>
              </span>}
              {!locked && expanded && <span className="row-more">
                {url && <>
                  <button type="button" className="button secondary" disabled={busy} onClick={() => copy(guest.id)}><CopyIcon />Copy private link</button>
                  {guest.rsvp === "pending" && <button type="button" className="button secondary" disabled={busy}
                    onClick={() => copyText(reminderText(guest.name, url), "Reminder message copied. Send it to the guest yourself, for example on WhatsApp.")}><CopyIcon />Copy reminder</button>}
                </>}
                <button type="button" className="button secondary" disabled={busy} onClick={() => { setRecording({ id: guest.id, name: guest.name, rsvp: guest.rsvp === "pending" ? "" : guest.rsvp, arrival: guest.expectedArrival ?? "", previousUpdatedAt: guest.rsvpUpdatedAt }); setSourceNote(""); setError(""); }}>Record phone reply</button>
                <button type="button" className="text-button" disabled={busy} onClick={() => remove(guest.id, guest.name)}>Remove</button>
              </span>}
            </li>
          );
        })}
      </ul>}
      <div className="actions">
      <button type="button" className="text-button" disabled={busy} onClick={refreshGuests}>Refresh guest list</button>
      <button type="button" className="text-button" aria-expanded={helpOpen} onClick={() => setHelpOpen(!helpOpen)}>About private links</button></div>
      {helpOpen && <p className="muted">Each guest gets a private link to answer Yes or No and share their arrival time. A link works for anyone who holds it, so share it with that guest only. Links show only when created or reset. Removing a guest also removes their answer. Guests never see each other or gift details.</p>}
    </section>
  );
}
