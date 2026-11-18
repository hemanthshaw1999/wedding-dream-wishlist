import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../src/server/database";
import { WishlistStore } from "../src/server/store";
import { ClaimsStore } from "../src/server/claims-store";
import { validateWishlist } from "../src/lib/wishlist";
import type { OwnerWishlist } from "../src/lib/wishlist";
import { csvCell, validateClaim } from "../src/lib/claims";

let db: DatabaseSync;
let wishlists: WishlistStore;
let claims: ClaimsStore;
let wishlist: OwnerWishlist;
beforeEach(() => {
  db = openDatabase(":memory:"); wishlists = new WishlistStore(db); claims = new ClaimsStore(db);
  for (const id of ["owner-a", "owner-b"]) db.prepare("INSERT INTO users VALUES(?,'fictional-demo',?)").run(id, new Date().toISOString());
  wishlist = wishlists.create("owner-a", validateWishlist({ displayNames: "Fictional couple", slug: "demo-couple", visibility: "unlisted",
    goals: [{ title: "Honeymoon", target: "1000" }] }));
  wishlist = wishlists.transition(wishlist.id, "owner-a", "published", 1);
});
afterEach(() => { db.close(); vi.useRealTimers(); });
function report(extra: Record<string, unknown> = {}) {
  return validateClaim({ goalId: wishlist.goals[0].id, recipientSnapshotId: wishlist.recipientSnapshot?.id,
    amount: "500", currency: "INR", guestName: "=HYPERLINK(\"bad\")", reference: "", token: randomBytes(32).toString("hex"), ...extra });
}
describe("manual claims and reproducible truthful progress", () => {
  it("stores an unverified declaration, not a received payment", () => {
    const input = report();
    const receipt = claims.report(wishlist.slug, input);
    expect(receipt.status).toBe("reported");
    expect(claims.dashboard(wishlist.id, "owner-a").totals.reportedPaise).toBe(50_000);
    expect(wishlists.getPublic(wishlist.slug).goals[0].confirmedPaise).toBe(0);
    expect(JSON.stringify(wishlists.getPublic(wishlist.slug))).not.toContain("HYPERLINK");
    expect(JSON.stringify(db.prepare("SELECT * FROM contributions").get())).not.toContain(input.token);
    expect(claims.status(input.token).id).toBe(receipt.id);
  });
  it("retries after timeout/pause return the same contribution without double counting", () => {
    const input = report();
    const first = claims.report(wishlist.slug, input);
    wishlists.transition(wishlist.id, "owner-a", "paused", 2);
    expect(claims.report(wishlist.slug, input).id).toBe(first.id);
    expect(db.prepare("SELECT COUNT(*) AS count FROM contributions").get()?.count).toBe(1);
    expect(db.prepare("SELECT COUNT(*) AS count FROM claim_events").get()?.count).toBe(1);
    expect(() => claims.report(wishlist.slug, { ...input, amountPaise: 100_000 })).toThrow("different report");
    expect(() => claims.report(wishlist.slug, report())).toThrow("not accepting");
  });
  it("confirms exactly once and reverses misconfirmation through new immutable events", () => {
    const entry = claims.report(wishlist.slug, report());
    claims.resolve(wishlist.id, entry.id, "owner-a", "owner_confirmed", 1, "Checked fictional bank records");
    expect(wishlists.getPublic(wishlist.slug).goals[0].confirmedPaise).toBe(50_000);
    expect(() => claims.resolve(wishlist.id, entry.id, "owner-a", "owner_confirmed", 1, "Retry")).toThrow("Another action");
    expect(() => claims.resolve(wishlist.id, entry.id, "owner-a", "owner_confirmed", 2, "Again")).toThrow("not allowed");
    claims.resolve(wishlist.id, entry.id, "owner-a", "needs_review", 2, "Mistaken confirmation");
    expect(wishlists.getPublic(wishlist.slug).goals[0].confirmedPaise).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS count FROM claim_events").get()?.count).toBe(3);
  });
  it("flags duplicate references as review signals without proving payment", () => {
    claims.report(wishlist.slug, report({ reference: "FAKE-123" }));
    const second = claims.report(wishlist.slug, report({ reference: " fake-123 " }));
    expect(second.status).toBe("needs_review");
    const dashboard = claims.dashboard(wishlist.id, "owner-a");
    expect(dashboard.claims.every((entry) => entry.duplicateReference)).toBe(true);
    expect(dashboard.totals.ownerConfirmedPaise).toBe(0);
  });
  it("enforces tenant boundaries, goal and recipient consistency", () => {
    const entry = claims.report(wishlist.slug, report());
    expect(() => claims.dashboard(wishlist.id, "owner-b")).toThrow("not found");
    expect(() => claims.resolve(wishlist.id, entry.id, "owner-b", "owner_confirmed", 1, "Forged owner")).toThrow("not found");
    expect(() => claims.report(wishlist.slug, report({ goalId: "another-goal" }))).toThrow("does not belong");
    expect(() => claims.report(wishlist.slug, report({ recipientSnapshotId: "stale" }))).toThrow("instructions changed");
  });
  it("does not let rejected/reviewed claims inflate totals", () => {
    const entry = claims.report(wishlist.slug, report());
    claims.resolve(wishlist.id, entry.id, "owner-a", "rejected", 1, "No matching record");
    expect(claims.dashboard(wishlist.id, "owner-a").totals.rejectedPaise).toBe(50_000);
    expect(wishlists.getPublic(wishlist.slug).goals[0].confirmedPaise).toBe(0);
    expect(() => claims.resolve(wishlist.id, entry.id, "owner-a", "owner_confirmed", 2, "Cannot skip review")).toThrow();
  });
  it("shows actual simulated overfunding, never truncates the confirmed amount", () => {
    for (let index = 0; index < 3; index++) {
      const entry = claims.report(wishlist.slug, report());
      claims.resolve(wishlist.id, entry.id, "owner-a", "owner_confirmed", 1, "Fictional matching record");
    }
    expect(wishlists.getPublic(wishlist.slug).goals[0].confirmedPaise).toBe(150_000);
  });
  it("expires high-entropy private status and never returns another guest's record", () => {
    const input = report();
    const entry = claims.report(wishlist.slug, input);
    expect(claims.status(input.token).id).toBe(entry.id);
    expect(() => claims.status(randomBytes(32).toString("hex"))).toThrow("not available");
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.now() + 8 * 86_400_000));
    expect(() => claims.status(input.token)).toThrow("expired");
  });
  it("protects immutable recipient, contribution terms and financial-event history", () => {
    const entry = claims.report(wishlist.slug, report());
    expect(() => db.prepare("UPDATE contributions SET amount_paise=1 WHERE id=?").run(entry.id)).toThrow("immutable");
    expect(() => db.exec("UPDATE recipient_snapshots SET label='attacker'")).toThrow("immutable");
    expect(() => db.exec("DELETE FROM claim_events")).toThrow("append-only");
    expect(() => db.exec("UPDATE claim_events SET confirmed_delta_paise=500")).toThrow("append-only");
  });
  it.each(["0", "-1", "0.99", "100000.01", "1e3", "1.001", "999999999999999"])("rejects report amount %s", (amount) => {
    expect(() => report({ amount })).toThrow();
  });
  it("rejects currency mismatch and fabricated confirmation fields", () => {
    expect(() => report({ currency: "USD" })).toThrow("INR");
    expect(() => report({ status: "owner_confirmed" })).toThrow("Unknown");
  });
  it.each(["=1+1", " +SUM(A1)", "\t@command", "-5", "\r\n=HYPERLINK(\"x\")"])("neutralizes spreadsheet input %j", (value) => {
    expect(csvCell(value)).toMatch(/^"'/);
  });
});
