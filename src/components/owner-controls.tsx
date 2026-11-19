"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useRef, useState } from "react";
import type { OwnerWishlist, WishlistState } from "@/lib/wishlist";
import { en } from "@/lib/strings";
import { requestJson, RequestError } from "./client-api";
import { OwnerGoals } from "./owner-goals";
import { ConfirmAction } from "./confirm-action";
import { useRequestLock } from "./use-request-lock";

export function OwnerControls({ wishlist, origin }: { wishlist: OwnerWishlist; origin: string }) {
  const router = useRouter();
  const [updated, setUpdated] = useState<{ source: OwnerWishlist; value: OwnerWishlist } | null>(null);
  const current = updated && !(wishlist !== updated.source && wishlist.version >= updated.value.version) ? updated.value : wishlist;
  const { busy, start, finish } = useRequestLock();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [qr, setQr] = useState("");
  const [sessionExpired, setSessionExpired] = useState(false);
  const [confirmState, setConfirmState] = useState<"closed" | "archived" | null>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  const guestUrl = `${origin}/w/${current.slug}`;
  const shareable = current.visibility !== "private" && ["published", "paused", "closed"].includes(current.state);
  const actions: Record<WishlistState, { state: WishlistState; label: string }[]> = {
    draft: [{ state: "published", label: "Publish after preview" }, { state: "closed", label: "Close wishlist" }],
    published: [{ state: "paused", label: "Pause wishlist" }, { state: "closed", label: "Close wishlist" }],
    paused: [{ state: "published", label: "Resume wishlist" }, { state: "closed", label: "Close wishlist" }],
    closed: [{ state: "archived", label: "Archive wishlist" }],
    archived: []
  };
  async function changeState(state: WishlistState) {
    if (!start()) return false;
    setError(""); setMessage("");
    try {
      const result = await requestJson<OwnerWishlist>(`/api/owner/wishlists/${current.id}`, "PATCH", { state, version: current.version });
      setUpdated({ source: wishlist, value: result });
      setMessage(`Wishlist is now ${result.state}.`);
      router.refresh();
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not update wishlist.");
      if (error instanceof RequestError && error.status === 401) setSessionExpired(true);
      return false;
    } finally { finish(); }
  }
  async function changeGoals(command: Record<string, unknown>) {
    if (!start()) return false;
    setError(""); setMessage("");
    try {
      const result = await requestJson<OwnerWishlist>(`/api/owner/wishlists/${current.id}/goals`, "PATCH", command);
      setUpdated({ source: wishlist, value: result });
      setMessage("Goals updated. Historical reports and confirmed progress are preserved.");
      router.refresh();
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not update goals.");
      if (error instanceof RequestError && error.status === 401) setSessionExpired(true);
      return false;
    } finally { finish(); }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(guestUrl);
      setMessage("Wishlist link copied.");
    } catch {
      linkRef.current?.focus(); linkRef.current?.select();
      setMessage("Automatic copy is unavailable. The link is selected; use your browser's Copy command.");
    }
  }
  async function createQr() {
    try {
      setQr(await QRCode.toDataURL(guestUrl, { width: 256, margin: 3, errorCorrectionLevel: "M", color: { dark: "#372a32", light: "#ffffff" } }));
      setMessage("Local wishlist-link QR created. This is not a payment QR.");
    } catch { setError("QR generation failed. You can still copy the wishlist link."); }
  }
  return (
    <><section id="publication" className="panel owner-controls" aria-labelledby="controls-title">
      <h2 id="controls-title">Preview and publication</h2>
      <p><strong>Current state: {current.state}.</strong> Visibility: {current.visibility}.</p>
      <p>{en.demo} Publishing here only enables anonymous access on this computer; it does not deploy the app.</p>
      {current.visibility === "private" && <p>Private wishlists remain unavailable to guests even when published.</p>}
      <div className="actions">
        {actions[current.state].map((action) => <button key={action.state} className="button secondary" disabled={busy} onClick={() => {
          if (action.state === "closed" || action.state === "archived") { setError(""); setConfirmState(action.state); }
          else void changeState(action.state);
        }}>{action.label}</button>)}
      </div>
      {error && !confirmState && <p role="alert" className="error-box">{error}</p>}
      {sessionExpired && <p><Link href={`/owner?${new URLSearchParams({ next: `/owner/${current.id}` })}`}>Sign in again</Link> to return to this wishlist. No state change was authorized.</p>}
      <p role="status">{message}</p>
      {shareable && (
        <div className="share-panel">
          <label htmlFor="share-link">Guest wishlist link (no owner token)</label>
          <input ref={linkRef} id="share-link" value={guestUrl} readOnly onFocus={(event) => event.target.select()} />
          <p className="muted">{en.localShare}</p>
          <div className="actions">
            <button className="button secondary" onClick={copy}>Copy link</button>
            <button className="button secondary" onClick={createQr}>Create link QR</button>
            <Link href={`/w/${current.slug}`}>Open guest view</Link>
          </div>
          {qr && <figure><Image src={qr} width={256} height={256} unoptimized alt={`Local wishlist link QR for ${current.displayNames}; not a payment QR`} /><figcaption><a href={qr} download={`${current.slug}-wishlist-link.png`}>Download link QR as PNG</a><p>If downloading is blocked, copy the link above.</p></figcaption></figure>}
        </div>
      )}
    </section>
    {confirmState && <ConfirmAction title={confirmState === "closed" ? "Close this wishlist?" : "Archive this wishlist?"}
      label={confirmState === "closed" ? "Close wishlist permanently" : "Archive wishlist permanently"} busy={busy} error={error}
      onCancel={() => { setConfirmState(null); setError(""); }} onConfirm={async () => { if (await changeState(confirmState)) setConfirmState(null); }}>
      <p>{confirmState === "closed" ? "Closing stops new guest reports and cannot be undone. Pause instead if you plan to reopen." : "Archiving removes guest access and cannot be undone. Existing reports and history are retained."}</p>
    </ConfirmAction>}
    <OwnerGoals wishlist={current} busy={busy} onChange={changeGoals} onRefresh={() => router.refresh()} /></>
  );
}
