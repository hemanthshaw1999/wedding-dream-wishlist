import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../src/server/database";
import { WishlistStore } from "../src/server/store";
import { GuestsStore } from "../src/server/guests-store";
import { validateGuestName, validateGuestNames, validateRsvpUpdate, validateHostRsvpUpdate } from "../src/lib/guests";
import { validateWishlist } from "../src/lib/wishlist";
import type { OwnerWishlist } from "../src/lib/wishlist";
import { createTestDatabase } from "./db-fixture";

let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Database;
let wishlists: WishlistStore;
let guests: GuestsStore;
let wishlist: OwnerWishlist;
beforeEach(async () => {
  fixture = await createTestDatabase();
  db = fixture.db; wishlists = new WishlistStore(db); guests = new GuestsStore(db);
  for (const id of ["owner-a", "owner-b"]) await db.run("INSERT INTO users VALUES($1,'fictional-demo',$2)", [id, new Date().toISOString()]);
  wishlist = await wishlists.create("owner-a", validateWishlist({ displayNames: "Fictional couple", slug: "guest-couple", visibility: "unlisted",
    goals: [{ title: "Trip", target: "1000" }] }));
  wishlist = await wishlists.transition(wishlist.id, "owner-a", "published", 1);
});
afterEach(async () => { await fixture.cleanup(); });

async function addGuest(name = "Aunt Meena") {
  const result = await guests.add(wishlist.id, "owner-a", name);
  return { token: result.invitePath.replace("/rsvp/", ""), list: result };
}

describe("validateGuestNames", () => {
  it("trims names and drops repeated lines case-insensitively", () => {
    expect(validateGuestNames({ names: [" Aunt Meena ", "aunt meena", "Ravi"] }).names).toEqual(["Aunt Meena", "Ravi"]);
  });
  it("rejects empty lines, unknown keys and empty lists", () => {
    expect(() => validateGuestNames({ names: ["Meena", ""] })).toThrowError(/guest names/);
    expect(() => validateGuestNames({ names: ["Meena"], token: "x" })).toThrowError(/only the guest names/);
    expect(() => validateGuestNames({ names: [] })).toThrowError(/between 1 and 200/);
  });
});

describe("guest list and RSVP", () => {
  it("adds guests, tracks summary counts, and rejects duplicates case-insensitively", async () => {
    await addGuest("Aunt Meena");
    await addGuest("Ravi Kumar");
    const list = await guests.list(wishlist.id, "owner-a");
    expect(list.guests).toHaveLength(2);
    expect(list.summary).toEqual({ invited: 2, attending: 0, notAttending: 0, awaiting: 2 });
    await expect(addGuest("aunt meena")).rejects.toThrowError(/already on the list/);
    await expect(guests.list(wishlist.id, "owner-b")).rejects.toThrowError(/not found/i);
    await expect(guests.add(wishlist.id, "owner-b", "X")).rejects.toThrowError(/not found/i);
    const guestId = (await guests.list(wishlist.id, "owner-a")).guests[0].id;
    await expect(guests.remove(wishlist.id, guestId, "owner-b")).rejects.toThrowError(/not found/i);
    await expect(guests.resetInvite(wishlist.id, guestId, "owner-b")).rejects.toThrowError(/not found/i);
    await expect(guests.remove(wishlist.id, guestId, "owner-a")).resolves.toBeTruthy();
    await expect(guests.remove(wishlist.id, guestId, "owner-a")).rejects.toThrowError(/not found/i);
  });

  it("adds many guests at once, skipping names already on the list and returning every new link", async () => {
    await addGuest("Aunt Meena");
    const result = await guests.addMany(wishlist.id, "owner-a", ["aunt meena", "Ravi Kumar", "Sana Sheikh"]);
    expect(result.duplicates).toEqual(["aunt meena"]);
    expect(result.added.map((entry) => entry.name)).toEqual(["Ravi Kumar", "Sana Sheikh"]);
    expect(result.summary.invited).toBe(3);
    for (const entry of result.added) {
      expect(entry.invitePath).toMatch(/^\/rsvp\//);
      const view = await guests.view(entry.invitePath.replace("/rsvp/", ""));
      expect(view.name).toBe(entry.name);
    }
    const again = await guests.addMany(wishlist.id, "owner-a", ["Ravi Kumar", "Sana Sheikh"]);
    expect(again.added).toEqual([]);
    expect(again.duplicates).toEqual(["Ravi Kumar", "Sana Sheikh"]);
    expect(again.summary.invited).toBe(3);
    await expect(guests.addMany(wishlist.id, "owner-b", ["X"])).rejects.toThrowError(/not found/i);
  });

  it("lets a guest answer Yes with an arrival time through the private link", async () => {
    const { token } = await addGuest();
    const view = await guests.view(token);
    expect(view.name).toBe("Aunt Meena");
    expect(view.rsvp).toBe("pending");
    expect(view.open).toBe(true);
    const answered = await guests.answer(token, { rsvp: "attending", expectedArrival: "19:00" });
    expect(answered.rsvp).toBe("attending");
    expect(answered.expectedArrival).toBe("19:00");
    const list = await guests.list(wishlist.id, "owner-a");
    expect(list.summary).toEqual({ invited: 1, attending: 1, notAttending: 0, awaiting: 0 });
    expect(list.guests[0].rsvpUpdatedAt).toBeTruthy();
  });

  it("clears the arrival time when the answer becomes No and refuses no-change saves", async () => {
    const { token } = await addGuest();
    await guests.answer(token, { rsvp: "attending", expectedArrival: "19:00" });
    const declined = await guests.answer(token, { rsvp: "not_attending", expectedArrival: "19:00" });
    expect(declined.expectedArrival).toBeNull();
    await expect(guests.answer(token, { rsvp: "not_attending", expectedArrival: null })).rejects.toThrowError(/already saved/);
    expect((await guests.list(wishlist.id, "owner-a")).summary).toEqual({ invited: 1, attending: 0, notAttending: 1, awaiting: 0 });
  });

  it("stores only a hash of the link token and resets links without losing the answer", async () => {
    const { token } = await addGuest();
    await guests.answer(token, { rsvp: "attending", expectedArrival: "18:30" });
    const stored = await db.get<{ token_hash: string }>("SELECT token_hash FROM wishlist_guests");
    expect(stored?.token_hash).not.toBe(token);
    const guestId = (await guests.list(wishlist.id, "owner-a")).guests[0].id;
    const reset = await guests.resetInvite(wishlist.id, guestId, "owner-a");
    const newToken = reset.invitePath.replace("/rsvp/", "");
    expect(newToken).not.toBe(token);
    await expect(guests.view(token)).rejects.toThrowError(/not available/);
    expect((await guests.view(newToken)).expectedArrival).toBe("18:30");
  });

  it("removes guests and their answers, and rejects bad input", async () => {
    const { token } = await addGuest();
    await guests.answer(token, { rsvp: "attending", expectedArrival: null });
    const guestId = (await guests.list(wishlist.id, "owner-a")).guests[0].id;
    await guests.remove(wishlist.id, guestId, "owner-a");
    expect((await guests.list(wishlist.id, "owner-a")).summary.invited).toBe(0);
    await expect(guests.view(token)).rejects.toThrowError(/not available/);
    const reinvited = await addGuest("Aunt Meena");
    expect(reinvited.list.summary).toEqual({ invited: 1, attending: 0, notAttending: 0, awaiting: 1 });
    expect(() => validateGuestName({ name: "" })).toThrowError();
    expect(() => validateGuestName({ name: "Ok", extra: 1 })).toThrowError(/only/);
    expect(() => validateRsvpUpdate({ rsvp: "maybe" })).toThrowError();
    expect(() => validateRsvpUpdate({ rsvp: "attending", expectedArrival: "7 pm" })).toThrowError();
    expect(validateRsvpUpdate({ rsvp: "attending", expectedArrival: "07:00" })).toEqual({ rsvp: "attending", expectedArrival: "07:00" });
  });

  it("hides RSVP links of private wishlists like unknown links", async () => {
    const privateWishlist = await wishlists.create("owner-a", validateWishlist({ displayNames: "Private couple", slug: "guest-private", visibility: "private",
      goals: [{ title: "Trip", target: "1000" }] }));
    await wishlists.transition(privateWishlist.id, "owner-a", "published", 1);
    const added = await guests.add(privateWishlist.id, "owner-a", "Hidden Guest");
    const token = added.invitePath.replace("/rsvp/", "");
    await expect(guests.view(token)).rejects.toThrowError(/not available/);
    await expect(guests.answer(token, { rsvp: "attending", expectedArrival: null })).rejects.toThrowError(/not available/);
  });

  it("closes RSVP when the wishlist is no longer published", async () => {
    const { token } = await addGuest();
    wishlist = await wishlists.transition(wishlist.id, "owner-a", "paused", wishlist.version);
    const view = await guests.view(token);
    expect(view.open).toBe(false);
    await expect(guests.answer(token, { rsvp: "attending", expectedArrival: null })).rejects.toThrowError(/closed/);
    await wishlists.transition(wishlist.id, "owner-a", "closed", wishlist.version);
    await expect(guests.answer(token, { rsvp: "attending", expectedArrival: null })).rejects.toThrowError(/closed/);
  });
});


describe("host-recorded phone replies", () => {
  it("validates a bounded source note and rejects absent concurrency state", () => {
    expect(() => validateHostRsvpUpdate({ rsvp: "attending", reason: "Phone call" })).toThrowError(/Refresh/);
    expect(() => validateHostRsvpUpdate({ rsvp: "attending", previousUpdatedAt: null, reason: "" })).toThrowError(/source note/);
    expect(() => validateHostRsvpUpdate({ rsvp: "attending", previousUpdatedAt: null, reason: "Phone call", owner: true })).toThrowError(/Unexpected/);
    expect(validateHostRsvpUpdate({ rsvp: "not_attending", previousUpdatedAt: null, reason: " Phone call " }).reason).toBe("Phone call");
  });
  it("records actor, before/after and source without publishing them or changing the link", async () => {
    const { token, list } = await addGuest();
    const guestId = list.guests[0].id;
    const result = await guests.recordAnswer(wishlist.id, guestId, "owner-a", { rsvp: "attending", expectedArrival: "18:30", previousUpdatedAt: null, reason: "Phone call with guest" });
    expect(result.summary.attending).toBe(1);
    expect((await guests.view(token)).expectedArrival).toBe("18:30");
    const audit = await db.get<{ actor_id: string; to_state: string }>("SELECT actor_id,to_state FROM audit_entries WHERE event='host_rsvp_recorded'");
    expect(audit?.actor_id).toBe("owner-a");
    const detail = JSON.parse(audit!.to_state);
    expect(detail.before.rsvp).toBe("pending"); expect(detail.after.rsvp).toBe("attending"); expect(detail.source).toBe("Phone call with guest");
    expect(JSON.stringify(await guests.view(token))).not.toContain("Phone call");
    await guests.answer(token, { rsvp: "not_attending", expectedArrival: null });
    expect((await guests.list(wishlist.id, "owner-a")).summary.notAttending).toBe(1);
  });
  it("rejects another owner, stale writes, no-change, removed guests and archived wishlists", async () => {
    const { token, list } = await addGuest();const id = list.guests[0].id;
    const input = { rsvp: "attending" as const, expectedArrival: "18:30", previousUpdatedAt: null, reason: "Phone call" };
    await expect(guests.recordAnswer(wishlist.id, id, "owner-b", input)).rejects.toThrowError(/not found/i);
    await guests.answer(token, { rsvp: "attending", expectedArrival: "19:00" });
    await expect(guests.recordAnswer(wishlist.id, id, "owner-a", input)).rejects.toThrowError(/changed/);
    const stamp = (await guests.list(wishlist.id, "owner-a")).guests[0].rsvpUpdatedAt;
    await expect(guests.recordAnswer(wishlist.id, id, "owner-a", { ...input, previousUpdatedAt: stamp, expectedArrival: "19:00" })).rejects.toThrowError(/already saved/);
    const declined = await guests.recordAnswer(wishlist.id, id, "owner-a", { ...input, previousUpdatedAt: stamp, rsvp: "not_attending" });
    expect(declined.guests[0].expectedArrival).toBeNull();
    await guests.remove(wishlist.id, id, "owner-a");
    await expect(guests.recordAnswer(wishlist.id, id, "owner-a", input)).rejects.toThrowError(/not found/i);
    const fresh = await addGuest("Ravi");
    wishlist = await wishlists.transition(wishlist.id, "owner-a", "closed", wishlist.version);
    wishlist = await wishlists.transition(wishlist.id, "owner-a", "archived", wishlist.version);
    await expect(guests.recordAnswer(wishlist.id, fresh.list.guests[0].id, "owner-a", input)).rejects.toThrowError(/read-only/);
  });
  it("serializes two stale host saves so only one changes the answer", async () => {
    const { list } = await addGuest();
    const input = { rsvp: "attending" as const, expectedArrival: null, previousUpdatedAt: null, reason: "Phone call" };
    const results = await Promise.allSettled([guests.recordAnswer(wishlist.id, list.guests[0].id, "owner-a", input), guests.recordAnswer(wishlist.id, list.guests[0].id, "owner-a", { ...input, rsvp: "not_attending" })]);
    expect(results.filter(item => item.status === "fulfilled")).toHaveLength(1);
    expect((await db.get<{count:string}>("SELECT count(*) AS count FROM audit_entries WHERE event='host_rsvp_recorded'"))?.count).toBe("1");
  });
});
