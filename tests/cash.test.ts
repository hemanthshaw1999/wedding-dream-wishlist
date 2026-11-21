import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../src/server/database";
import { WishlistStore } from "../src/server/store";
import { CashStore, validateCashGift } from "../src/server/cash-store";
import { validateWishlist } from "../src/lib/wishlist";
import type { OwnerWishlist } from "../src/lib/wishlist";
import { createTestDatabase } from "./db-fixture";

let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Database;
let wishlists: WishlistStore;
let cash: CashStore;
let wishlist: OwnerWishlist;
beforeEach(async () => {
  fixture = await createTestDatabase();
  db = fixture.db; wishlists = new WishlistStore(db); cash = new CashStore(db);
  for (const id of ["owner-a", "owner-b"]) await db.run("INSERT INTO users VALUES($1,'fictional-demo',$2)", [id, new Date().toISOString()]);
  wishlist = await wishlists.create("owner-a", validateWishlist({ displayNames: "Fictional couple", slug: "cash-couple", visibility: "unlisted",
    goals: [{ title: "Trip", target: "1000" }] }));
  wishlist = await wishlists.transition(wishlist.id, "owner-a", "published", 1);
});
afterEach(async () => { await fixture.cleanup(); });

const gift = (extra: Record<string, unknown> = {}) => validateCashGift({ goalId: wishlist.goals[0].id, amount: "400", ...extra });

describe("owner cash gifts", () => {
  it("counts toward goal progress, can be voided once, and keeps the record", async () => {
    await cash.add(wishlist.id, "owner-a", gift({ donorName: "Uncle", note: "envelope" }));
    let view = await wishlists.getOwner(wishlist.id, "owner-a");
    expect(view.goals[0].confirmedPaise).toBe(40000);
    const list = await cash.list(wishlist.id, "owner-a");
    expect(list).toHaveLength(1);
    await cash.void(wishlist.id, list[0].id, "owner-a");
    view = await wishlists.getOwner(wishlist.id, "owner-a");
    expect(view.goals[0].confirmedPaise).toBe(0);
    expect(await cash.list(wishlist.id, "owner-a")).toHaveLength(1);
    await expect(cash.void(wishlist.id, list[0].id, "owner-a")).rejects.toThrowError(/already voided/);
  });
  it("reaches the goal with cash and does not double count", async () => {
    await cash.add(wishlist.id, "owner-a", gift({ amount: "600" }));
    await cash.add(wishlist.id, "owner-a", gift({ amount: "400" }));
    const view = await wishlists.getOwner(wishlist.id, "owner-a");
    expect(view.goals[0].confirmedPaise).toBe(100000);
    expect(view.goals[0].confirmedPaise >= view.goals[0].targetPaise).toBe(true);
  });
  it("isolates owners and rejects unknown or archived goals and bad input", async () => {
    await expect(cash.add(wishlist.id, "owner-b", gift())).rejects.toThrowError(/not found/i);
    await expect(cash.list(wishlist.id, "owner-b")).rejects.toThrowError(/not found/i);
    await expect(cash.add(wishlist.id, "owner-a", validateCashGift({ goalId: "nope", amount: "400" }))).rejects.toThrowError(/Goal not found/);
    expect(() => validateCashGift({ goalId: wishlist.goals[0].id, amount: "0.5" })).toThrowError();
    expect(() => validateCashGift({ goalId: wishlist.goals[0].id, amount: "400", extra: 1 })).toThrowError(/Send only/);
  });
  it("cannot be edited or deleted in the database", async () => {
    await cash.add(wishlist.id, "owner-a", gift());
    await expect(db.run("UPDATE cash_gifts SET amount_paise=999900")).rejects.toThrow();
    await expect(db.run("DELETE FROM cash_gifts")).rejects.toThrow();
  });
});

import { validateClaim } from "../src/lib/claims";
describe("supporters opt-in", () => {
  const base = { goalId: "g", recipientSnapshotId: "r", amount: "500", currency: "INR", token: "a".repeat(64) };
  it("requires a name to opt in, defaults to private, rejects non-boolean", () => {
    expect(validateClaim(base).publicDisplay).toBe(false);
    expect(validateClaim({ ...base, guestName: "Asha", publicDisplay: true }).publicDisplay).toBe(true);
    expect(() => validateClaim({ ...base, publicDisplay: true })).toThrowError(/name/);
    expect(() => validateClaim({ ...base, guestName: "A", publicDisplay: "yes" })).toThrowError(/public display/);
  });
  it("lists only confirmed opted-in gifts, never cash, and never exposes private ones", async () => {
    await cash.add(wishlist.id, "owner-a", gift({ donorName: "Cash Uncle" }));
    const pub = await wishlists.getPublic("cash-couple");
    expect(pub.supporters).toEqual([]);
    expect(pub.goals[0].confirmedPaise).toBe(40000);
  });
});

describe("supporters list end to end (database level)", () => {
  it("ranks confirmed opted-in gifts, excludes others, and honours withdrawal without touching the total", async () => {
    const { ClaimsStore } = await import("../src/server/claims-store");
    const { randomBytes } = await import("node:crypto");
    const claims = new ClaimsStore(db);
    const mk = (amount: string, extra: Record<string, unknown>) => validateClaim({ goalId: wishlist.goals[0].id, recipientSnapshotId: wishlist.recipientSnapshot?.id,
      amount, currency: "INR", token: randomBytes(32).toString("hex"), ...extra });
    const inputs = [mk("100", { guestName: "Small Public", publicDisplay: true }), mk("300", { guestName: "Big Public", publicDisplay: true }),
      mk("200", { guestName: "Private Pat" }), mk("250", { publicDisplay: false }), mk("150", { guestName: "Unconfirmed Public", publicDisplay: true })];
    const ids: string[] = [];
    for (const input of inputs) ids.push((await claims.report(wishlist.slug, input)).id);
    for (const id of ids.slice(0, 4)) {
      const dash = await claims.dashboard(wishlist.id, "owner-a");
      const claim = dash.claims.find((c) => c.id === id)!;
      await claims.resolve(wishlist.id, id, "owner-a", "owner_confirmed", claim.version, "test");
    }
    await cash.add(wishlist.id, "owner-a", gift({ donorName: "Cash Uncle" }));
    let pub = await wishlists.getPublic(wishlist.slug);
    expect(pub.supporters.map((s) => [s.name, s.rank, s.relativeImpact])).toEqual([["Big Public", 1, 100], ["Small Public", 2, 30]]);
    expect(JSON.stringify(pub.supporters)).not.toContain("amount");
    const total = pub.goals[0].confirmedPaise;
    expect(total).toBe(10000 + 30000 + 20000 + 25000 + 40000);
    await claims.withdrawListing(inputs[1].token);
    pub = await wishlists.getPublic(wishlist.slug);
    expect(pub.supporters.map((s) => s.name)).toEqual(["Small Public"]);
    expect(pub.goals[0].confirmedPaise).toBe(total);
    await expect(claims.withdrawListing("bad")).rejects.toThrow();
  });
});
