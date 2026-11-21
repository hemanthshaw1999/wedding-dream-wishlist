import { afterEach, beforeEach, expect, it } from "vitest";
import { createTestDatabase } from "./db-fixture";
import { WishlistStore } from "../src/server/store";
import { GuestsStore } from "../src/server/guests-store";
import { validateWishlist } from "../src/lib/wishlist";

let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
beforeEach(async () => { fixture = await createTestDatabase(); });
afterEach(async () => { await fixture.cleanup(); });
async function setup() {
  await fixture.db.run("INSERT INTO users VALUES('owner','fictional-demo',$1)", [new Date().toISOString()]);
  return new WishlistStore(fixture.db).create("owner", validateWishlist({ displayNames: "Fictional index test", slug: "index-test", visibility: "unlisted", goals: [{ title: "Home", target: "1000" }] }));
}
it("migrates targeted indexes with covering/partial predicates and no redundant history index", async () => {
  const rows = await fixture.db.all<{ indexname: string; indexdef: string }>("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public'");
  expect(rows.find(r => r.indexname === "memberships_user_wishlists")?.indexdef).toContain("INCLUDE (wishlist_id)");
  expect(rows.find(r => r.indexname === "wishlist_guests_active_order")).toBeUndefined();
  expect(rows.find(r => r.indexname === "contributions_public_supporters")?.indexdef).toMatch(/owner_confirmed.*public_display/);
  expect(rows.find(r => r.indexname === "goal_history_pkey")?.indexdef).toContain("(goal_id, version)");
});
it("enforces guest row invariants in PostgreSQL, not only HTTP validation", async () => {
  const wishlist = await setup();
  await new GuestsStore(fixture.db).add(wishlist.id, "owner", "Aunt Meena");
  for (const sql of ["UPDATE wishlist_guests SET normalized_name='wrong'", "UPDATE wishlist_guests SET expected_arrival='18:00'", "UPDATE wishlist_guests SET token_hash='plaintext'"]) {
    await expect(fixture.db.run(sql)).rejects.toThrow(/check constraint/);
  }
});
it("serializes additions at the guest cap and makes archived/removed lists read-only", async () => {
  const wishlist = await setup();
  const guests = new GuestsStore(fixture.db);
  await fixture.db.run(`INSERT INTO wishlist_guests(id,wishlist_id,name,normalized_name,token_hash,created_at)
    SELECT 'guest-'||n,$1,'Guest '||n,'guest '||n,md5(n::text)||md5(n::text),$2 FROM generate_series(1,999) n`, [wishlist.id, new Date().toISOString()]);
  const results = await Promise.allSettled([guests.add(wishlist.id, "owner", "Last A"), guests.add(wishlist.id, "owner", "Last B")]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect((await guests.list(wishlist.id, "owner")).summary.invited).toBe(1000);
  await fixture.db.run(`INSERT INTO wishlists SELECT 'other-'||n,'other-slug-'||n,display_names,story,wedding_date,expires_at,visibility,state,currency,payment_mode,funding_policy,version,created_at,updated_at,live_recipient_id FROM wishlists CROSS JOIN generate_series(1,100) n WHERE id=$1`, [wishlist.id]);
  await fixture.db.run(`INSERT INTO wishlist_guests(id,wishlist_id,name,normalized_name,token_hash,created_at)
    SELECT 'other-guest-'||n||'-'||g,'other-'||n,'Guest '||g,'guest '||g,md5(n::text||'-'||g)||md5(n::text||'-'||g),$1 FROM generate_series(1,100) n CROSS JOIN generate_series(1,200) g`, [new Date().toISOString()]);
  await fixture.db.run("ANALYZE wishlist_guests");
  const plan = await fixture.db.all(`EXPLAIN (ANALYZE, BUFFERS) SELECT id,name,rsvp,expected_arrival,rsvp_updated_at,created_at
    FROM wishlist_guests WHERE wishlist_id=$1 AND removed_at IS NULL ORDER BY lower(name),id LIMIT 1000`, [wishlist.id]);
  console.log("Representative active guest order plan", plan.map(r => r["QUERY PLAN"]).join("\n"));
  const guestId = (await guests.list(wishlist.id, "owner")).guests[0].id;
  await guests.remove(wishlist.id, guestId, "owner");
  await expect(guests.resetInvite(wishlist.id, guestId, "owner")).rejects.toThrow(/not found/i);
  await new WishlistStore(fixture.db).transition(wishlist.id, "owner", "closed", 1);
  await new WishlistStore(fixture.db).transition(wishlist.id, "owner", "archived", 2);
  await expect(guests.remove(wishlist.id, "guest-2", "owner")).rejects.toThrow(/read-only/i);
  await expect(guests.resetInvite(wishlist.id, "guest-2", "owner")).rejects.toThrow(/read-only/i);
});
