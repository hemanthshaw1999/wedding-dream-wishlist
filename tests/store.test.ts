import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../src/server/database";
import { WishlistStore } from "../src/server/store";
import { validateWishlist } from "../src/lib/wishlist";

let db: DatabaseSync;
let store: WishlistStore;
const fixture = {
  displayNames: "Tara & Arjun", story: "Fictional only", slug: "example-couple", visibility: "unlisted",
  goals: [{ title: "Honeymoon", target: "300000" }]
};
beforeEach(() => {
  db = openDatabase(":memory:");
  store = new WishlistStore(db);
  for (const id of ["owner-a", "owner-b"]) db.prepare("INSERT INTO users VALUES(?,'fictional-demo',?)").run(id, new Date().toISOString());
});
afterEach(() => db.close());
const create = () => store.create("owner-a", validateWishlist(fixture));

describe("SQLite persistence and tenant boundaries", () => {
  it("saves draft and goals atomically with a separate ownership relation", () => {
    const value = create();
    expect(value.state).toBe("draft");
    expect(value.goals[0].targetPaise).toBe(30_000_000);
    expect(store.listOwner("owner-a")).toHaveLength(1);
    expect(store.listOwner("owner-b")).toEqual([]);
    expect(() => store.getPublic(value.slug)).toThrow("not available");
  });
  it("denies Owner B reading and changing Owner A's wishlist", () => {
    const value = create();
    expect(() => store.getOwner(value.id, "owner-b")).toThrow("not found");
    expect(() => store.transition(value.id, "owner-b", "published", 1)).toThrow("not found");
    expect(store.getOwner(value.id, "owner-a").state).toBe("draft");
  });
  it("publishes an allowlisted anonymous projection without owner data", () => {
    const value = create();
    store.transition(value.id, "owner-a", "published", value.version);
    const guest = store.getPublic(value.slug);
    expect(Object.keys(guest).sort()).toEqual(["availability", "currency", "displayNames", "expiresAt", "goals", "paymentMode", "recipientSnapshot", "slug", "story", "weddingDate"].sort());
    expect(JSON.stringify(guest)).not.toContain("owner-a");
    expect(guest.goals[0].confirmedPaise).toBe(0);
    expect(guest.paymentMode).toBe("demo");
  });
  it("never exposes a private published wishlist", () => {
    const value = store.create("owner-a", validateWishlist({ ...fixture, visibility: "private" }));
    store.transition(value.id, "owner-a", "published", 1);
    expect(() => store.getPublic(value.slug)).toThrow("not available");
  });
  it("keeps paused/closed links readable, but removes archived links", () => {
    const value = create();
    store.transition(value.id, "owner-a", "published", 1);
    store.transition(value.id, "owner-a", "paused", 2);
    expect(store.getPublic(value.slug).availability).toBe("paused");
    store.transition(value.id, "owner-a", "closed", 3);
    expect(store.getPublic(value.slug).availability).toBe("closed");
    store.transition(value.id, "owner-a", "archived", 4);
    expect(() => store.getPublic(value.slug)).toThrow();
    expect(db.prepare("SELECT COUNT(*) AS count FROM audit_entries").get()?.count).toBe(5);
  });
  it("rejects a stale second-tab state change without extra audit events", () => {
    const value = create();
    store.transition(value.id, "owner-a", "published", 1);
    expect(() => store.transition(value.id, "owner-a", "closed", 1)).toThrow("another tab");
    expect(db.prepare("SELECT COUNT(*) AS count FROM audit_entries").get()?.count).toBe(2);
  });
  it("makes duplicate creation safe through unique slugs and rollback", () => {
    create();
    expect(() => create()).toThrow("already in use");
    expect(db.prepare("SELECT COUNT(*) AS count FROM wishlists").get()?.count).toBe(1);
    expect(db.prepare("SELECT COUNT(*) AS count FROM goals").get()?.count).toBe(1);
  });
  it("rolls back a failed ownership insert", () => {
    expect(() => store.create("nonexistent-user", validateWishlist(fixture))).toThrow();
    expect(db.prepare("SELECT COUNT(*) AS count FROM wishlists").get()?.count).toBe(0);
  });
  it("enforces financial isolation and append-only action history", () => {
    const value = create();
    expect(() => db.prepare("UPDATE wishlists SET payment_mode='provider' WHERE id=?").run(value.id)).toThrow();
    expect(() => db.prepare("UPDATE wishlists SET funding_policy='allow' WHERE id=?").run(value.id)).toThrow();
    expect(() => db.prepare("UPDATE goals SET target_paise=-1 WHERE wishlist_id=?").run(value.id)).toThrow();
    expect(() => db.prepare("UPDATE goals SET target_paise=1.5 WHERE wishlist_id=?").run(value.id)).toThrow();
    expect(() => db.exec("DELETE FROM audit_entries")).toThrow("append-only");
    expect(() => db.exec("UPDATE audit_entries SET event='forged'")).toThrow("append-only");
  });
  it("treats SQL-like content literally", () => {
    const value = store.create("owner-a", validateWishlist({ ...fixture, displayNames: "'); DROP TABLE users; --" }));
    expect(store.getOwner(value.id, "owner-a").displayNames).toContain("DROP TABLE");
    expect(db.prepare("SELECT COUNT(*) AS count FROM users").get()?.count).toBe(2);
  });
  it("survives connection restart on disk", () => {
    const directory = mkdtempSync(join(tmpdir(), "wishlist-test-"));
    const path = join(directory, "demo.sqlite");
    const disk = openDatabase(path);
    try {
      disk.prepare("INSERT INTO users VALUES(?,'fictional-demo',?)").run("disk-owner", new Date().toISOString());
      const value = new WishlistStore(disk).create("disk-owner", validateWishlist({ ...fixture, slug: randomUUID() }));
      disk.close();
      const reopened = openDatabase(path);
      try { expect(new WishlistStore(reopened).getOwner(value.id, "disk-owner").goals).toHaveLength(1); }
      finally { reopened.close(); }
    } finally { rmSync(directory, { recursive: true }); }
  });
  it("refuses an unrelated database before applying app migrations", () => {
    const directory = mkdtempSync(join(tmpdir(), "wishlist-isolation-"));
    const path = join(directory, "unrelated.sqlite");
    const unrelated = new DatabaseSync(path);
    unrelated.exec("CREATE TABLE unrelated(value TEXT); INSERT INTO unrelated VALUES('untouched')");
    unrelated.close();
    try {
      expect(() => openDatabase(path)).toThrow("unmarked");
      const check = new DatabaseSync(path, { readOnly: true });
      try {
        expect(check.prepare("SELECT value FROM unrelated").get()?.value).toBe("untouched");
        expect(check.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table'").get()?.count).toBe(1);
      } finally { check.close(); }
    } finally { rmSync(directory, { recursive: true }); }
  });
});
