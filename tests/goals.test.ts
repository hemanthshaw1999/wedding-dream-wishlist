import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate, openDatabase, type Database } from "../src/server/database";
import { WishlistStore } from "../src/server/store";
import { ClaimsStore } from "../src/server/claims-store";
import { validateGoalCommand, validateWishlist, type OwnerWishlist } from "../src/lib/wishlist";
import { validateClaim } from "../src/lib/claims";
import { createTestDatabase } from "./db-fixture";

let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Database;
let store: WishlistStore;
let claims: ClaimsStore;
let value: OwnerWishlist;
beforeEach(async () => {
  fixture = await createTestDatabase(); db = fixture.db;
  store = new WishlistStore(db); claims = new ClaimsStore(db);
  for (const id of ["owner-a", "owner-b"]) await db.run("INSERT INTO users VALUES($1,'fictional-demo',$2)", [id, new Date().toISOString()]);
  value = await store.create("owner-a", validateWishlist({ displayNames: "Fictional couple", slug: "goal-couple", visibility: "unlisted",
    goals: [{ title: "Honeymoon", target: "1000" }, { title: "Dinner", target: "2000" }] }));
});
afterEach(async () => { await fixture.cleanup(); });
async function change(input: Record<string, unknown>) {
  value = await store.changeGoals(value.id, "owner-a", { version: value.version, reason: "Private owner reason", ...input });
  return value;
}
async function publish() { value = await store.transition(value.id, "owner-a", "published", value.version); }
function report(goalId = value.goals[0].id) {
  return validateClaim({ goalId, recipientSnapshotId: value.recipientSnapshot?.id, amount: "500",
    currency: "INR", token: randomBytes(32).toString("hex") });
}
function edit(target: string, extra: Record<string, unknown> = {}) {
  const goal = value.goals[0];
  return { action: "edit", goalId: goal.id, title: goal.title, description: goal.description, target, ...extra };
}
const historyCount = async () => Number((await db.get("SELECT count(*) AS count FROM goal_history"))?.count);

describe("audited PostgreSQL goal lifecycle", () => {
  it("adds, edits, swaps, archives and restores without deleting goals or leaking private history", async () => {
    expect(await historyCount()).toBe(2);
    await change(edit("1500", { title: "A quiet honeymoon", description: "Fictional updated purpose" }));
    await change({ action: "add", title: "Our home", target: "3000" });
    const reversed = value.goals.map((goal) => goal.id).reverse();
    await change({ action: "reorder", goalIds: reversed });
    expect(value.goals.map((goal) => goal.id)).toEqual(reversed);
    await change({ action: "archive", goalId: reversed[0] });
    expect(value.goals[0].archivedAt).not.toBeNull();
    await change({ action: "restore", goalId: reversed[0] });
    expect(value.goals[0].archivedAt).toBeNull();
    expect(value.goals).toHaveLength(3);
    const history = await store.goalHistory(value.id, "owner-a");
    expect(history.entries.some((entry) => entry.event === "reordered")).toBe(true);
    expect(history.entries.some((entry) => entry.event === "updated" && entry.before?.title === "Honeymoon")).toBe(true);
    await publish();
    const guest = await store.getPublic(value.slug);
    expect(guest.goals.find((goal) => goal.title === "A quiet honeymoon")?.targetHistory[0]).toMatchObject({ previousPaise: 100_000, targetPaise: 150_000 });
    expect(Object.keys(guest.goals[0]).sort()).toEqual(["id", "title", "description", "targetPaise", "confirmedPaise", "archivedAt", "targetHistory"].sort());
    expect(JSON.stringify(guest)).not.toMatch(/Private owner reason|owner-a|hasReports|before_snapshot/);
  });

  it("freezes reported purpose, requires target acknowledgement and preserves actual confirmed progress", async () => {
    await publish();
    const entry = await claims.report(value.slug, report());
    await expect(change(edit("1500", { title: "Different purpose", acknowledged: true }))).rejects.toThrow("cannot change");
    await expect(change(edit("1500"))).rejects.toThrow("Acknowledge");
    await claims.resolve(value.id, entry.id, "owner-a", "owner_confirmed", 1, "Fictional matching bank record");
    await expect(change(edit("499", { acknowledged: true }))).rejects.toThrow("below current confirmed");
    await change(edit("1500", { acknowledged: true }));
    expect(value.goals[0].confirmedPaise).toBe(50_000);
    expect(value.goals[0].hasReports).toBe(true);
    await claims.resolve(value.id, entry.id, "owner-a", "needs_review", 2, "Fictional correction");
    await claims.resolve(value.id, entry.id, "owner-a", "rejected", 3, "No matching record");
    await expect(change(edit("1500", { description: "Rewritten after rejection" }))).rejects.toThrow("cannot change");
    expect((await store.goalHistory(value.id, "owner-a")).entries.filter((entry) => entry.event === "updated")).toHaveLength(1);
  });

  it("rejects fresh archived reports but keeps private retries, reviews and totals intact", async () => {
    await publish();
    const input = report();
    const entry = await claims.report(value.slug, input);
    const goalId = input.goalId;
    await change({ action: "archive", goalId });
    await expect(claims.report(value.slug, report(goalId))).rejects.toThrow("archived");
    expect((await claims.report(value.slug, input)).id).toBe(entry.id);
    await claims.resolve(value.id, entry.id, "owner-a", "owner_confirmed", 1, "Fictional record checked after archive");
    expect((await store.getPublic(value.slug)).goals[0]).toMatchObject({ confirmedPaise: 50_000 });
    expect((await claims.status(input.token)).status).toBe("owner_confirmed");
    await expect(change(edit("2000", { acknowledged: true }))).rejects.toThrow("Restore");
    await change({ action: "restore", goalId });
    expect((await claims.report(value.slug, report(goalId))).status).toBe("reported");
  });

  it("enforces tenant boundaries, exact reorder membership, stale versions and terminal wishlist states", async () => {
    const command = { action: "archive", goalId: value.goals[0].id, version: value.version, reason: "Owner-only change" };
    await expect(store.changeGoals(value.id, "owner-b", command)).rejects.toThrow("not found");
    await expect(store.goalHistory(value.id, "owner-b")).rejects.toThrow("not found");
    await expect(change({ action: "archive", goalId: "foreign-goal" })).rejects.toThrow("not found");
    await expect(change({ action: "reorder", goalIds: [value.goals[0].id, "foreign-goal"] })).rejects.toThrow("every goal");
    const concurrent = await Promise.allSettled([command, { ...command, goalId: value.goals[1].id }].map((input) => store.changeGoals(value.id, "owner-a", input)));
    expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await historyCount()).toBe(3);
    value = await store.getOwner(value.id, "owner-a");
    await expect(store.changeGoals(value.id, "owner-a", command)).rejects.toThrow("another tab");
    value = await store.transition(value.id, "owner-a", "closed", value.version);
    await expect(change({ action: "add", title: "Too late", target: "1000" })).rejects.toThrow("Closed");
  });

  it("serializes report/archive and confirmation/target races through the same parent lock", async () => {
    await publish();
    const input = report();
    const race = await Promise.allSettled([
      claims.report(value.slug, input),
      change({ action: "archive", goalId: input.goalId })
    ]);
    expect(race[1].status).toBe("fulfilled");
    expect((await store.getOwner(value.id, "owner-a")).goals[0].archivedAt).not.toBeNull();
    if (race[0].status === "fulfilled") expect((await claims.report(value.slug, input)).id).toBe(race[0].value.id);
    else expect(race[0].reason.message).toContain("archived");
    await change({ action: "restore", goalId: input.goalId });
    const entry = await claims.report(value.slug, report());
    const targetRace = await Promise.allSettled([
      claims.resolve(value.id, entry.id, "owner-a", "owner_confirmed", 1, "Fictional bank check"),
      change(edit("400", { acknowledged: true }))
    ]);
    expect(targetRace[0].status).toBe("fulfilled");
    if (targetRace[1].status === "rejected") expect(targetRace[1].reason.message).toContain("below current confirmed");
    const current = await store.getOwner(value.id, "owner-a");
    expect(current.goals[0].confirmedPaise).toBe(50_000);
    expect(current.goals[0].targetPaise).toBe(targetRace[1].status === "fulfilled" ? 40_000 : 100_000);
  });

  it("enforces trigger history, actor context and transaction rollback under the restricted runtime", async () => {
    const restricted = await createTestDatabase({ restrictedRuntime: true });
    const runtime = openDatabase(restricted.runtimeUrl, ["test"]);
    try {
      await restricted.db.run("INSERT INTO users VALUES('runtime-owner','fictional-demo',$1)", [new Date().toISOString()]);
      const runtimeStore = new WishlistStore(runtime);
      const current = await runtimeStore.create("runtime-owner", validateWishlist({ displayNames: "Fictional runtime", slug: "runtime-couple", visibility: "private",
        goals: [{ title: "First", target: "1000" }] }));
      await runtimeStore.changeGoals(current.id, "runtime-owner", { action: "edit", goalId: current.goals[0].id, title: "Updated first", target: "1200", version: 1, reason: "Audited runtime change" });
      await expect(runtime.run("UPDATE goals SET title='No actor'")).rejects.toThrow("authenticated owner");
      await expect(runtime.run("DELETE FROM goal_history")).rejects.toThrow("permission denied");
      await expect(restricted.db.run("UPDATE goal_history SET reason='forged'")).rejects.toThrow("append-only");
      await expect(restricted.db.run("DELETE FROM goals")).rejects.toThrow("append-only");
      await expect(runtime.transaction(async (tx) => {
        await tx.run("SELECT set_config('app.actor_id','runtime-owner',true),set_config('app.change_reason','Must roll back',true)");
        await tx.run("UPDATE goals SET title='Temporary edit'");
        await tx.run("UPDATE goals SET target_paise=-1");
      })).rejects.toThrow();
      expect((await runtimeStore.getOwner(current.id, "runtime-owner")).goals[0].title).toBe("Updated first");
      expect((await runtimeStore.goalHistory(current.id, "runtime-owner")).entries).toHaveLength(2);
    } finally { await runtime.close(); await restricted.cleanup(); }
  });

  it("caps retained goals and bounded projections without truncating immutable history", async () => {
    const many = await store.create("owner-a", validateWishlist({ displayNames: "Fictional many", slug: "many-goals", visibility: "private",
      goals: Array.from({ length: 20 }, (_, index) => ({ title: `Goal ${index}`, target: "1000" })) }));
    await store.changeGoals(many.id, "owner-a", { action: "archive", goalId: many.goals[0].id, version: 1, reason: "Retain archived history" });
    await expect(store.changeGoals(many.id, "owner-a", { action: "add", title: "Too many", target: "1000", version: 2, reason: "Still capped" })).rejects.toThrow("at most 20");
    for (let index = 0; index < 23; index++) await change(edit(String(1100 + index)));
    expect(value.goals[0].targetHistory).toHaveLength(20);
    expect((await store.goalHistory(value.id, "owner-a")).entries.filter((entry) => entry.event === "updated")).toHaveLength(23);
  });

  it("backfills existing schema-4 goals as explicit migration baselines, not invented authorship", async () => {
    const legacy = await createTestDatabase({ migrate: false });
    try {
      for (const file of ["001_core.sql", "002_auth.sql", "003_optional_timestamp.sql", "004_auth_email.sql"]) {
        await legacy.db.run(readFileSync(resolve("migrations", "postgres", file), "utf8"));
      }
      await legacy.db.run(`INSERT INTO app_metadata VALUES('environment','test');
        CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
        INSERT INTO schema_migrations(version) VALUES(1),(2),(3),(4)`);
      const now = new Date().toISOString();
      await legacy.db.run("INSERT INTO users VALUES('legacy-owner','fictional-demo',$1)", [now]);
      await legacy.db.run(`INSERT INTO wishlists(id,slug,display_names,story,visibility,state,currency,payment_mode,funding_policy,created_at,updated_at)
        VALUES('legacy-list','legacy-couple','Fictional legacy','','private','draft','INR','demo','undecided',$1,$1)`, [now]);
      await legacy.db.run("INSERT INTO memberships VALUES('legacy-list','legacy-owner','owner')");
      await legacy.db.run("INSERT INTO goals VALUES('legacy-goal','legacy-list','Legacy purpose','',100000,0)");
      await migrate(legacy.db, "test"); await migrate(legacy.db, "test");
      const history = await new WishlistStore(legacy.db).goalHistory("legacy-list", "legacy-owner");
      expect(history.entries).toHaveLength(1);
      expect(history.entries[0]).toMatchObject({ event: "baseline", before: null, after: { title: "Legacy purpose", targetPaise: 100_000 } });
      expect((await legacy.db.get("SELECT actor_id FROM goal_history"))?.actor_id).toBeNull();
    } finally { await legacy.cleanup(); }
  });

  it.each([
    { action: "add", title: "Goal", target: "100", extra: true },
    { action: "edit", goalId: "goal", title: "Goal", target: "100", acknowledged: "yes" },
    { action: "reorder", goalIds: ["same", "same"] },
    { action: "__proto__" }, { action: "delete", goalId: "goal" },
    { action: "add", title: "Goal", target: "1e3" },
    { action: "add", title: "Goal", target: "100", version: "1" },
    { action: "archive", goalId: "goal", reason: "" }
  ])("rejects malformed or unsupported commands %#", (command) => {
    expect(() => validateGoalCommand({ version: 1, reason: "Required reason", ...command })).toThrow();
  });
});
