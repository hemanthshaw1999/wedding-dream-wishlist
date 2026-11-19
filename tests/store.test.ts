import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate, openDatabase, poolOptions, type Database } from "../src/server/database";
import { WishlistStore } from "../src/server/store";
import { validateWishlist } from "../src/lib/wishlist";
import { createTestDatabase } from "./db-fixture";

let fixtureDb: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Database;
let store: WishlistStore;
const fixture = { displayNames: "Tara & Arjun", story: "Fictional only", slug: "example-couple", visibility: "unlisted",
  goals: [{ title: "Honeymoon", target: "300000" }] };
beforeEach(async () => {
  fixtureDb = await createTestDatabase();
  db = fixtureDb.db; store = new WishlistStore(db);
  for (const id of ["owner-a", "owner-b"]) await db.run("INSERT INTO users VALUES($1,'fictional-demo',$2)", [id, new Date().toISOString()]);
});
afterEach(async () => { await fixtureDb.cleanup(); });
const create = () => store.create("owner-a", validateWishlist(fixture));
const count = async (table: "wishlists" | "goals" | "users" | "audit_entries") =>
  Number((await db.get(`SELECT COUNT(*) AS count FROM ${table}`))?.count);

describe("PostgreSQL durability and tenant boundaries", () => {
  it("saves draft and goals atomically with separate ownership", async () => {
    const value = await create();
    expect(value.state).toBe("draft"); expect(value.goals[0].targetPaise).toBe(30_000_000);
    expect(await store.listOwner("owner-a")).toHaveLength(1);
    expect(await store.listOwner("owner-b")).toEqual([]);
    await expect(store.getPublic(value.slug)).rejects.toThrow("not available");
  });
  it("denies Owner B reading/changing Owner A's wishlist", async () => {
    const value = await create();
    await expect(store.getOwner(value.id, "owner-b")).rejects.toThrow("not found");
    await expect(store.transition(value.id, "owner-b", "published", 1)).rejects.toThrow("not found");
    expect((await store.getOwner(value.id, "owner-a")).state).toBe("draft");
  });
  it("publishes only the anonymous allowlist", async () => {
    const value = await create(); await store.transition(value.id, "owner-a", "published", value.version);
    const guest = await store.getPublic(value.slug);
    expect(Object.keys(guest).sort()).toEqual(["availability", "currency", "displayNames", "expiresAt", "goals", "liveRecipient", "paymentMode", "recipientSnapshot", "slug", "story", "supporters", "weddingDate"].sort());
    expect(JSON.stringify(guest)).not.toContain("owner-a");
    expect(guest.goals[0].confirmedPaise).toBe(0); expect(guest.paymentMode).toBe("demo");
  });
  it("never exposes private wishlists", async () => {
    const value = await store.create("owner-a", validateWishlist({ ...fixture, visibility: "private" }));
    await store.transition(value.id, "owner-a", "published", 1);
    await expect(store.getPublic(value.slug)).rejects.toThrow("not available");
  });
  it("keeps paused/closed links readable but removes archived links", async () => {
    const value = await create();
    await store.transition(value.id, "owner-a", "published", 1);
    await store.transition(value.id, "owner-a", "paused", 2);
    expect((await store.getPublic(value.slug)).availability).toBe("paused");
    await store.transition(value.id, "owner-a", "closed", 3);
    expect((await store.getPublic(value.slug)).availability).toBe("closed");
    await store.transition(value.id, "owner-a", "archived", 4);
    await expect(store.getPublic(value.slug)).rejects.toThrow();
    expect(await count("audit_entries")).toBe(5);
  });
  it("serializes concurrent version changes without duplicate audit entries", async () => {
    const value = await create();
    const results = await Promise.allSettled(["published", "closed"].map((state) => store.transition(value.id, "owner-a", state, 1)));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await count("audit_entries")).toBe(2);
  });
  it("handles simultaneous slug collisions through a unique constraint and rollback", async () => {
    const results = await Promise.allSettled([create(), create()]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((result) => result.status === "rejected");
    expect(failed?.reason.message).toContain("already in use");
    expect(await count("wishlists")).toBe(1); expect(await count("goals")).toBe(1);
  });
  it("rolls back failed ownership inserts", async () => {
    await expect(store.create("nonexistent-user", validateWishlist(fixture))).rejects.toThrow();
    expect(await count("wishlists")).toBe(0);
  });
  it("protects financial policy, exact paise and append-only history", async () => {
    const value = await create();
    await expect(db.run("UPDATE wishlists SET payment_mode='provider' WHERE id=$1", [value.id])).rejects.toThrow();
    await expect(db.run("UPDATE wishlists SET funding_policy='allow' WHERE id=$1", [value.id])).rejects.toThrow();
    await expect(db.run("UPDATE goals SET target_paise=-1 WHERE wishlist_id=$1", [value.id])).rejects.toThrow();
    await expect(db.run("UPDATE goals SET target_paise=1.5 WHERE wishlist_id=$1", [value.id])).rejects.toThrow();
    await expect(db.run("DELETE FROM audit_entries")).rejects.toThrow("append-only");
    await expect(db.run("UPDATE audit_entries SET event='forged'")).rejects.toThrow("append-only");
  });
  it("treats SQL-like text literally", async () => {
    const value = await store.create("owner-a", validateWishlist({ ...fixture, displayNames: "'); DROP TABLE users; --" }));
    expect((await store.getOwner(value.id, "owner-a")).displayNames).toContain("DROP TABLE");
    expect(await count("users")).toBe(2);
  });
  it("persists independently of application connection lifetimes", async () => {
    const value = await create();
    await db.close();
    const reopened = openDatabase(fixtureDb.connectionString);
    try { expect((await new WishlistStore(reopened).getOwner(value.id, "owner-a")).goals).toHaveLength(1); }
    finally { await reopened.close(); }
  });
  it("refuses unrelated or mismatched-environment databases before migration", async () => {
    const unrelated = await createTestDatabase({ migrate: false });
    try {
      await unrelated.db.run("CREATE TABLE unrelated(value TEXT); INSERT INTO unrelated VALUES('untouched')");
      await expect(migrate(unrelated.db, "test")).rejects.toThrow("unmarked");
      expect((await unrelated.db.get("SELECT value FROM unrelated"))?.value).toBe("untouched");
      expect((await unrelated.db.all("SELECT tablename FROM pg_tables WHERE schemaname='public'"))).toHaveLength(1);
      await expect(migrate(db, "production")).rejects.toThrow("environment");
    } finally { await unrelated.cleanup(); }
  });
  it("requires certificate verification for remote databases", () => {
    expect(poolOptions("postgresql://test:fictional@db.example.test/app?sslmode=require").ssl).toEqual({ rejectUnauthorized: true });
    expect(() => poolOptions("postgresql://test:fictional@db.example.test/app?sslmode=disable")).toThrow("cannot be disabled");
    expect(() => poolOptions("postgresql://test:fictional@db.example.test/app?sslcert=unsafe")).toThrow("Custom TLS");
  });
  it("uses a runtime role that cannot alter schemas or delete financial history", async () => {
    const restricted = await createTestDatabase({ restrictedRuntime: true });
    const runtime = openDatabase(restricted.runtimeUrl, ["test"]);
    const mismatched = openDatabase(restricted.runtimeUrl, ["production"]);
    const privileged = openDatabase(restricted.connectionString, ["test"]);
    try {
      await expect(mismatched.ready()).rejects.toThrow("environment");
      await expect(privileged.ready()).rejects.toThrow("restricted");
      await expect(runtime.run("CREATE TABLE unsafe(value TEXT)")).rejects.toThrow("permission denied");
      await expect(runtime.run("ALTER TABLE contributions DISABLE TRIGGER ALL")).rejects.toThrow("owner");
      await expect(runtime.run("DELETE FROM claim_events")).rejects.toThrow("permission denied");
      await expect(runtime.run("UPDATE schema_migrations SET version=999")).rejects.toThrow("permission denied");
    } finally { await runtime.close(); await mismatched.close(); await privileged.close(); await restricted.cleanup(); }
  });
});
