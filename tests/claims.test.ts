import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import type { Database } from "../src/server/database";
import { WishlistStore } from "../src/server/store";
import { ClaimsStore } from "../src/server/claims-store";
import { validateWishlist } from "../src/lib/wishlist";
import type { OwnerWishlist } from "../src/lib/wishlist";
import { csvCell, validateClaim } from "../src/lib/claims";
import { createTestDatabase } from "./db-fixture";

let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Database;
let wishlists: WishlistStore;
let claims: ClaimsStore;
let wishlist: OwnerWishlist;
beforeEach(async () => {
  fixture = await createTestDatabase(); db = fixture.db;
  wishlists = new WishlistStore(db); claims = new ClaimsStore(db);
  for (const id of ["owner-a", "owner-b"]) await db.run("INSERT INTO users VALUES($1,'fictional-demo',$2)", [id, new Date().toISOString()]);
  wishlist = await wishlists.create("owner-a", validateWishlist({ displayNames: "Fictional couple", slug: "demo-couple", visibility: "unlisted",
    goals: [{ title: "Honeymoon", target: "1000" }] }));
  wishlist = await wishlists.transition(wishlist.id, "owner-a", "published", 1);
});
afterEach(async () => { vi.useRealTimers(); await fixture.cleanup(); });
function report(extra: Record<string, unknown> = {}) {
  return validateClaim({ goalId: wishlist.goals[0].id, recipientSnapshotId: wishlist.recipientSnapshot?.id,
    amount: "500", currency: "INR", guestName: "=HYPERLINK(\"bad\")", reference: "", token: randomBytes(32).toString("hex"), ...extra });
}
const progress = async () => (await wishlists.getPublic(wishlist.slug)).goals[0].confirmedPaise;
const count = async (table: "contributions" | "claim_events") => Number((await db.get(`SELECT COUNT(*) AS count FROM ${table}`))?.count);

describe("PostgreSQL manual reports and reproducible truthful progress", () => {
  it("keeps reports, totals, count and revision in one bounded database snapshot", async () => {
    const first = await claims.report(wishlist.slug, report());
    await claims.report(wishlist.slug, report({ amount: "250" }));
    const query = vi.spyOn(db.pool, "query");
    const before = await claims.dashboard(wishlist.id, "owner-a");
    expect(query).toHaveBeenCalledTimes(1);
    query.mockRestore();
    expect(before).toMatchObject({ total: 2, revision: 2, totals: { reportedPaise: 75_000, ownerConfirmedPaise: 0 } });
    expect(before.claims.map((entry) => entry.amountPaise).sort()).toEqual([25_000, 50_000]);
    await claims.resolve(wishlist.id, first.id, "owner-a", "owner_confirmed", 1, "Fictional record checked");
    const filtered = await claims.dashboard(wishlist.id, "owner-a", "reported");
    expect(filtered).toMatchObject({ total: 1, revision: 3, totals: { reportedPaise: 25_000, ownerConfirmedPaise: 50_000 } });
    expect(filtered.claims).toHaveLength(1);
    expect((await claims.dashboard(wishlist.id, "owner-a", "reported", 2)).claims).toEqual([]);
  });
  it("holds a consistent whole-page read while a confirmation commits on another connection", async () => {
    const entry = await claims.report(wishlist.slug, report());
    await db.readSnapshot(async (tx) => {
      expect((await new WishlistStore(tx).getPublic(wishlist.slug)).goals[0].confirmedPaise).toBe(0);
      await claims.resolve(wishlist.id, entry.id, "owner-a", "owner_confirmed", 1, "Concurrent fictional check");
      const owner = await new WishlistStore(tx).getOwner(wishlist.id, "owner-a");
      const dashboard = await new ClaimsStore(tx).dashboard(wishlist.id, "owner-a");
      expect(owner.goals[0].confirmedPaise).toBe(0);
      expect(dashboard).toMatchObject({ revision: 1, totals: { reportedPaise: 50_000, ownerConfirmedPaise: 0 } });
      expect(dashboard.claims[0].status).toBe("reported");
    });
    expect(await progress()).toBe(50_000);
    expect((await claims.dashboard(wishlist.id, "owner-a")).revision).toBe(2);
  });
  it("stores an unverified declaration, never an automatic receipt", async () => {
    const input = report(); const receipt = await claims.report(wishlist.slug, input);
    expect(receipt.status).toBe("reported");
    expect((await claims.dashboard(wishlist.id, "owner-a")).totals.reportedPaise).toBe(50_000);
    expect(await progress()).toBe(0);
    expect(JSON.stringify(await wishlists.getPublic(wishlist.slug))).not.toContain("HYPERLINK");
    expect(JSON.stringify(await db.get("SELECT * FROM contributions"))).not.toContain(input.token);
    expect((await claims.status(input.token)).id).toBe(receipt.id);
  });
  it("handles simultaneous submissions and retry after pause without double counting", async () => {
    const input = report();
    const entries = await Promise.all(Array.from({ length: 8 }, () => claims.report(wishlist.slug, input)));
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(1);
    await wishlists.transition(wishlist.id, "owner-a", "paused", 2);
    expect((await claims.report(wishlist.slug, input)).id).toBe(entries[0].id);
    expect(await count("contributions")).toBe(1); expect(await count("claim_events")).toBe(1);
    await expect(claims.report(wishlist.slug, { ...input, amountPaise: 100_000 })).rejects.toThrow("different report");
    await expect(claims.report(wishlist.slug, report())).rejects.toThrow("not accepting");
  });
  it("confirms exactly once under contention and reverses through new events", async () => {
    const entry = await claims.report(wishlist.slug, report());
    const confirmations = await Promise.allSettled([0, 1].map(() => claims.resolve(wishlist.id, entry.id, "owner-a", "owner_confirmed", 1, "Checked fictional bank record")));
    expect(confirmations.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await progress()).toBe(50_000);
    await expect(claims.resolve(wishlist.id, entry.id, "owner-a", "owner_confirmed", 2, "Again")).rejects.toThrow("not allowed");
    await claims.resolve(wishlist.id, entry.id, "owner-a", "needs_review", 2, "Mistaken confirmation");
    expect(await progress()).toBe(0); expect(await count("claim_events")).toBe(3);
  });
  it("serializes concurrent duplicate reference review without treating it as proof", async () => {
    const entries = await Promise.all([0, 1].map(() => claims.report(wishlist.slug, report({ reference: " fake-123 " }))));
    expect(entries.map((entry) => entry.status).sort()).toEqual(["needs_review", "reported"]);
    const dashboard = await claims.dashboard(wishlist.id, "owner-a");
    expect(dashboard.claims.every((entry) => entry.duplicateReference)).toBe(true);
    expect(dashboard.totals.ownerConfirmedPaise).toBe(0);
  });
  it("enforces owner, goal and recipient boundaries", async () => {
    const entry = await claims.report(wishlist.slug, report());
    await expect(claims.dashboard(wishlist.id, "owner-b")).rejects.toThrow("not found");
    await expect(claims.resolve(wishlist.id, entry.id, "owner-b", "owner_confirmed", 1, "Forged owner")).rejects.toThrow("not found");
    await expect(claims.report(wishlist.slug, report({ goalId: "another-goal" }))).rejects.toThrow("does not belong");
    await expect(claims.report(wishlist.slug, report({ recipientSnapshotId: "stale" }))).rejects.toThrow("instructions changed");
  });
  it("keeps rejected/reviewed claims out of confirmed totals", async () => {
    const entry = await claims.report(wishlist.slug, report());
    await claims.resolve(wishlist.id, entry.id, "owner-a", "rejected", 1, "No matching record");
    expect((await claims.dashboard(wishlist.id, "owner-a")).totals.rejectedPaise).toBe(50_000);
    expect(await progress()).toBe(0);
    await expect(claims.resolve(wishlist.id, entry.id, "owner-a", "owner_confirmed", 2, "Cannot skip review")).rejects.toThrow();
  });
  it("shows actual simulated overfunding without truncating money totals", async () => {
    const entries = await Promise.all([0, 1, 2].map(() => claims.report(wishlist.slug, report())));
    await Promise.all(entries.map((entry) => claims.resolve(wishlist.id, entry.id, "owner-a", "owner_confirmed", 1, "Fictional matching record")));
    expect(await progress()).toBe(150_000);
  });
  it("expires scoped private status links without exposing other guests", async () => {
    const input = report(); const entry = await claims.report(wishlist.slug, input);
    expect((await claims.status(input.token)).id).toBe(entry.id);
    await expect(claims.status(randomBytes(32).toString("hex"))).rejects.toThrow("not available");
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(Date.now() + 8 * 86_400_000));
    await expect(claims.status(input.token)).rejects.toThrow("expired");
  });
  it("protects immutable recipient, contribution terms and ledger history", async () => {
    const entry = await claims.report(wishlist.slug, report());
    await expect(db.run("UPDATE contributions SET amount_paise=1 WHERE id=$1", [entry.id])).rejects.toThrow("immutable");
    await expect(db.run("UPDATE recipient_snapshots SET label='attacker'")).rejects.toThrow("immutable");
    await expect(db.run("DELETE FROM claim_events")).rejects.toThrow("append-only");
    await expect(db.run("UPDATE claim_events SET confirmed_delta_paise=500")).rejects.toThrow("append-only");
    await expect(db.run("UPDATE contributions SET status='owner_confirmed' WHERE id=$1", [entry.id])).rejects.toThrow("ledger mismatch");
    expect(await progress()).toBe(0);
  });
  it.each(["0", "-1", "0.99", "100000.01", "1e3", "1.001", "999999999999999"])("rejects report amount %s", (amount) => {
    expect(() => report({ amount })).toThrow();
  });
  it("rejects wrong currency and fabricated confirmation fields", () => {
    expect(() => report({ currency: "USD" })).toThrow("INR");
    expect(() => report({ status: "owner_confirmed" })).toThrow("Unknown");
  });
  it.each(["=1+1", " +SUM(A1)", "\t@command", "-5", "\r\n=HYPERLINK(\"x\")"])("neutralizes spreadsheet input %j", (value) => {
    expect(csvCell(value)).toMatch(/^"'/);
  });
});
