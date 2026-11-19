"use client";

import { useLayoutEffect, useId, useRef, type ReactNode } from "react";

export function ConfirmAction({ title, children, label, busy, error, onCancel, onConfirm }: {
  title: string; children: ReactNode; label: string; busy: boolean; error: string;
  onCancel: () => void; onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected && !previousFocus.matches(":disabled")) previousFocus.focus();
      else document.getElementById("main")?.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={dialogRef} className="confirm-dialog" aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}>
    <h2 id={titleId}>{title}</h2><div id={descriptionId}>{children}</div>
    {error && <p role="alert" className="error-box">{error}</p>}
    <div className="actions"><button type="button" className="button secondary" disabled={busy} onClick={onCancel}>Cancel</button><button type="button" className="button" disabled={busy} onClick={onConfirm}>{busy ? "Saving..." : label}</button></div>
  </dialog>;
}
