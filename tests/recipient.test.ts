import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import type { Database } from "../src/server/database";
import { WishlistStore } from "../src/server/store";
import { ClaimsStore } from "../src/server/claims-store";
import { validateRecipient, validateWishlist } from "../src/lib/wishlist";
import { validateClaim } from "../src/lib/claims";
import type { OwnerWishlist } from "../src/lib/wishlist";
import { createTestDatabase } from "./db-fixture";

let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Database;
let wishlists: WishlistStore;
let claims: ClaimsStore;
let wishlist: OwnerWishlist;
beforeEach(async () => {
  fixture = await createTestDatabase();
  db = fixture.db; wishlists = new WishlistStore(db); claims = new ClaimsStore(db);
  for (const id of ["owner-a", "owner-b"]) await db.run("INSERT INTO users VALUES($1,'fictional-demo',$2)", [id, new Date().toISOString()]);
  wishlist = await wishlists.create("owner-a", validateWishlist({ displayNames: "Fictional couple", slug: "live-couple", visibility: "unlisted",
    goals: [{ title: "Honeymoon", target: "1000" }] }));
  wishlist = await wishlists.transition(wishlist.id, "owner-a", "published", 1);
});
afterEach(async () => { delete process.env.LIVE_UPI_APPROVED; await fixture.cleanup(); });

const recipient = (extra: Record<string, unknown> = {}) => validateRecipient({ upiId: "couple@okbank", label: "Tara & Arjun", ...extra });
const activate = (extra: Record<string, unknown> = {}) =>
  wishlists.activateLive(wishlist.id, "owner-a", { version: wishlist.version, recipientVersionId: "", confirmUpiId: "couple@okbank", acknowledged: true, ...extra });
const liveReport = (versionId: string, extra: Record<string, unknown> = {}) =>
  validateClaim({ goalId: wishlist.goals[0].id, recipientVersionId: versionId, amount: "500", currency: "INR", guestName: "", reference: "", token: randomBytes(32).toString("hex"), ...extra });

describe("versioned live direct-UPI recipient setup", () => {
  it("validates recipient syntax without claiming ownership verification", () => {
    expect(recipient()).toEqual({ upiId: "couple@okbank", label: "Tara & Arjun" });
    for (const bad of ["no-at-sign", "@bank", "a@1bank", "name@", "na me@bank", "a@bank.toolongextension123456789012345678901234567890"]) {
      expect(() => recipient({ upiId: bad })).toThrowError(/UPI ID|Check upiId/);
    }
    expect(() => recipient({ upiId: "couple@okbank", extra: true })).toThrowError(/Unknown recipient fields/);
  });

  it("creates immutable per-wishlist versions scoped to the owner", async () => {
    const first = await wishlists.addRecipientVersion(wishlist.id, "owner-a", recipient());
    const second = await wishlists.addRecipientVersion(wishlist.id, "owner-a", recipient({ upiId: "couple@hdfcbank" }));
    expect([first.version, second.version]).toEqual([1, 2]);
    await expect(wishlists.addRecipientVersion(wishlist.id, "owner-b", recipient())).rejects.toThrow(/not found/);
    expect((await wishlists.recipientVersions(wishlist.id, "owner-a")).map((row) => row.version)).toEqual([2, 1]);
    await expect(wishlists.recipientVersions(wishlist.id, "owner-b")).rejects.toThrow(/not found/);
    await expect(db.run("UPDATE recipient_versions SET upi_id='attacker@okbank' WHERE id=$1", [first.id])).rejects.toThrow(/append-only/);
    await expect(db.run("DELETE FROM recipient_versions WHERE id=$1", [first.id])).rejects.toThrow(/append-only/);
    expect((await wishlists.getOwner(wishlist.id, "owner-a")).liveRecipient).toBeNull();
  });

  it("activates live instructions only after exact review and locks reported demo history out", async () => {
    process.env.LIVE_UPI_APPROVED = "yes";
    const version = await wishlists.addRecipientVersion(wishlist.id, "owner-a", recipient());
    await expect(activate({ recipientVersionId: version.id, confirmUpiId: "typo@okbank" })).rejects.toThrow(/exact UPI ID/);
    await expect(activate({ recipientVersionId: version.id, acknowledged: false })).rejects.toThrow(/acknowledge/);
    await expect(activate({ recipientVersionId: version.id, version: 99 })).rejects.toThrow(/changed in another tab/);
    await expect(wishlists.activateLive(wishlist.id, "owner-b", { version: 2, recipientVersionId: version.id, confirmUpiId: "couple@okbank", acknowledged: true })).rejects.toThrow(/not found/);
    const live = await activate({ recipientVersionId: version.id });
    expect(live.paymentMode).toBe("upi");
    expect(live.liveRecipient).toMatchObject({ id: version.id, version: 1, upiId: "couple@okbank", label: "Tara & Arjun" });
    const guest = await wishlists.getPublic(wishlist.slug);
    expect(guest.paymentMode).toBe("upi");
    expect(guest.liveRecipient?.upiId).toBe("couple@okbank");
    expect(JSON.stringify(guest)).not.toContain("owner-a");
    // One-way only: no downgrade, no re-activation of the same version, no second payment mode.
    await expect(db.run("UPDATE wishlists SET payment_mode='demo' WHERE id=$1", [wishlist.id])).rejects.toThrow(/cannot change back/);
    await expect(db.run("UPDATE wishlists SET funding_policy='undecided' WHERE id=$1", [wishlist.id])).rejects.toThrow(/cannot change once set/);
    await expect(wishlists.activateLive(wishlist.id, "owner-a", { version: live.version, recipientVersionId: version.id, confirmUpiId: "couple@okbank", acknowledged: true })).rejects.toThrow(/already active/);
    const audit = await db.get("SELECT event FROM audit_entries WHERE wishlist_id=$1 AND event='live_activated'", [wishlist.id]);
    expect(audit).toBeTruthy();
  });

  it("never converts a wishlist with existing demo reports into a live one", async () => {
    process.env.LIVE_UPI_APPROVED = "yes";
    await claims.report(wishlist.slug, validateClaim({ goalId: wishlist.goals[0].id, recipientSnapshotId: wishlist.recipientSnapshot?.id,
      amount: "500", currency: "INR", guestName: "", reference: "", token: randomBytes(32).toString("hex") }));
    const version = await wishlists.addRecipientVersion(wishlist.id, "owner-a", recipient());
    await expect(activate({ recipientVersionId: version.id })).rejects.toThrow(/never become a live-payment wishlist/);
    await expect(db.run("UPDATE wishlists SET payment_mode='upi',funding_policy='allow_overfunding',live_recipient_id=$1 WHERE id=$2", [version.id, wishlist.id])).rejects.toThrow(/never change payment mode/);
    expect((await wishlists.getPublic(wishlist.slug)).paymentMode).toBe("demo");
  });

  it("binds live reports to the active version and rejects stale instructions", async () => {
    process.env.LIVE_UPI_APPROVED = "yes";
    const first = await wishlists.addRecipientVersion(wishlist.id, "owner-a", recipient());
    wishlist = await activate({ recipientVersionId: first.id });
    const receipt = await claims.report(wishlist.slug, liveReport(first.id));
    expect(receipt.mode).toBe("upi");
    expect(receipt.recipientLabel).toBe("Tara & Arjun");
    const stored = await db.get("SELECT recipient_snapshot_id, recipient_version_id FROM contributions WHERE id=$1", [receipt.id]);
    expect(stored?.recipient_snapshot_id).toBeNull();
    expect(stored?.recipient_version_id).toBe(first.id);
    // A guest holding an older instruction version cannot report against it after a switch.
    const second = await wishlists.addRecipientVersion(wishlist.id, "owner-a", recipient({ upiId: "couple@hdfcbank" }));
    wishlist = await wishlists.activateLive(wishlist.id, "owner-a", { version: wishlist.version, recipientVersionId: second.id, confirmUpiId: "couple@hdfcbank", acknowledged: true });
    await expect(claims.report(wishlist.slug, liveReport(first.id))).rejects.toThrow(/Recipient instructions changed/);
    await expect(claims.report(wishlist.slug, liveReport(second.id))).resolves.toMatchObject({ mode: "upi", status: "reported" });
  });

  it("keeps idempotent receipts after pause, and marks late live reports for careful review", async () => {
    process.env.LIVE_UPI_APPROVED = "yes";
    const version = await wishlists.addRecipientVersion(wishlist.id, "owner-a", recipient());
    wishlist = await activate({ recipientVersionId: version.id });
    const token = randomBytes(32).toString("hex");
    const input = liveReport(version.id, { token });
    const first = await claims.report(wishlist.slug, input);
    wishlist = await wishlists.transition(wishlist.id, "owner-a", "paused", wishlist.version);
    // The same private key replays the same receipt even while paused; different terms conflict.
    expect(await claims.report(wishlist.slug, input)).toEqual(first);
    await expect(claims.report(wishlist.slug, liveReport(version.id, { token, amount: "700" }))).rejects.toThrow(/different report/);
    // A genuinely late report (money already paid) is accepted but forced into careful review.
    const late = await claims.report(wishlist.slug, liveReport(version.id));
    expect(late.status).toBe("needs_review");
    const event = await db.get("SELECT reason FROM claim_events WHERE contribution_id=$1", [late.id]);
    expect(event?.reason).toContain("paused");
    // Closed collections stop new live reports entirely; existing receipts still replay.
    wishlist = await wishlists.transition(wishlist.id, "owner-a", "closed", wishlist.version);
    await expect(claims.report(wishlist.slug, liveReport(version.id))).rejects.toThrow(/not accepting reports/);
    expect(await claims.report(wishlist.slug, input)).toEqual(first);
  });

  it("keeps live confirmation on the same append-only ledger", async () => {
    process.env.LIVE_UPI_APPROVED = "yes";
    const version = await wishlists.addRecipientVersion(wishlist.id, "owner-a", recipient());
    wishlist = await activate({ recipientVersionId: version.id });
    const entry = await claims.report(wishlist.slug, liveReport(version.id));
    await claims.resolve(wishlist.id, entry.id, "owner-a", "owner_confirmed", 1, "Checked fictional bank records");
    expect((await wishlists.getPublic(wishlist.slug)).goals[0].confirmedPaise).toBe(50_000);
    await claims.resolve(wishlist.id, entry.id, "owner-a", "needs_review", 2, "Reversal is not a refund");
    expect((await wishlists.getPublic(wishlist.slug)).goals[0].confirmedPaise).toBe(0);
    const events = await db.get("SELECT COALESCE(SUM(confirmed_delta_paise),0) AS net FROM claim_events WHERE contribution_id=$1", [entry.id]);
    expect(Number(events?.net)).toBe(0);
  });

  it("keeps every live path off while the operator approval gate is unset", async () => {
    const version = await wishlists.addRecipientVersion(wishlist.id, "owner-a", recipient());
    await expect(activate({ recipientVersionId: version.id })).rejects.toThrow(/disabled for this deployment/);
    expect((await wishlists.getOwner(wishlist.id, "owner-a")).paymentMode).toBe("demo");
    const guest = await wishlists.getPublic(wishlist.slug);
    expect(guest.paymentMode).toBe("demo");
    expect(guest.liveRecipient).toBeNull();
    // Guests cannot bind reports to an inert version while the gate is off.
    await expect(claims.report(wishlist.slug, liveReport(version.id))).rejects.toThrow();
    // An inexact attestation value does not open the gate either.
    process.env.LIVE_UPI_APPROVED = "true";
    await expect(activate({ recipientVersionId: version.id })).rejects.toThrow(/disabled for this deployment/);
    expect((await wishlists.getPublic(wishlist.slug)).liveRecipient).toBeNull();
  });

  it("keeps existing live rows dark while the operator gate is unset or inexact", async () => {
    process.env.LIVE_UPI_APPROVED = "yes";
    const version = await wishlists.addRecipientVersion(wishlist.id, "owner-a", recipient());
    wishlist = await activate({ recipientVersionId: version.id });
    const token = randomBytes(32).toString("hex");
    const input = liveReport(version.id, { token });
    const first = await claims.report(wishlist.slug, input);
    expect((await wishlists.getPublic(wishlist.slug)).liveRecipient?.upiId).toBe("couple@okbank");

    // Gate closes: the already-live row stops projecting payable instructions to guests.
    delete process.env.LIVE_UPI_APPROVED;
    const guest = await wishlists.getPublic(wishlist.slug);
    expect(guest.paymentMode).toBe("upi");
    expect(guest.liveRecipient).toBeNull();
    expect(JSON.stringify(guest)).not.toContain("couple@okbank");
    // New live reports are refused; existing receipts still replay and stay readable.
    await expect(claims.report(wishlist.slug, liveReport(version.id))).rejects.toThrow(/disabled for this deployment/);
    expect(await claims.report(wishlist.slug, input)).toEqual(first);
    expect((await claims.status(token)).mode).toBe("upi");
    // The owner still sees their own live setup; only the guest surface goes dark.
    expect((await wishlists.getOwner(wishlist.id, "owner-a")).liveRecipient?.upiId).toBe("couple@okbank");

    // An inexact attestation value keeps the same rows dark.
    process.env.LIVE_UPI_APPROVED = "true";
    expect((await wishlists.getPublic(wishlist.slug)).liveRecipient).toBeNull();
    expect(JSON.stringify(await wishlists.getPublic(wishlist.slug))).not.toContain("couple@okbank");
    await expect(claims.report(wishlist.slug, liveReport(version.id))).rejects.toThrow(/disabled for this deployment/);
    expect(await claims.report(wishlist.slug, input)).toEqual(first);

    // Recording approval restores the guest projection and new live reports.
    process.env.LIVE_UPI_APPROVED = "yes";
    expect((await wishlists.getPublic(wishlist.slug)).liveRecipient?.upiId).toBe("couple@okbank");
    await expect(claims.report(wishlist.slug, liveReport(version.id))).resolves.toMatchObject({ mode: "upi", status: "reported" });
  });

  it("leaves demo wishlists and their reports untouched by the live path", async () => {
    expect((await wishlists.getPublic(wishlist.slug)).liveRecipient).toBeNull();
    await expect(claims.report(wishlist.slug, liveReport("anything"))).rejects.toThrow();
    const receipt = await claims.report(wishlist.slug, validateClaim({ goalId: wishlist.goals[0].id, recipientSnapshotId: wishlist.recipientSnapshot?.id,
      amount: "500", currency: "INR", guestName: "", reference: "", token: randomBytes(32).toString("hex") }));
    expect(receipt.mode).toBe("demo");
    const stored = await db.get("SELECT recipient_version_id FROM contributions WHERE id=$1", [receipt.id]);
    expect(stored?.recipient_version_id).toBeNull();
  });
});
