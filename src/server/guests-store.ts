import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Database } from "./database.ts";
import { AppError } from "../lib/errors.ts";
import type { BulkGuestResult, HostRsvpUpdate, GuestEntry, GuestRsvp, OwnerGuestList, RsvpView } from "../lib/guests.ts";

type Row = {
  id: string; name: string; rsvp: GuestRsvp; expected_arrival: string | null;
  rsvp_updated_at: string | null; created_at: string;
};

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

function entry(row: Row): GuestEntry {
  return { id: row.id, name: row.name, rsvp: row.rsvp, expectedArrival: row.expected_arrival,
    rsvpUpdatedAt: row.rsvp_updated_at, createdAt: row.created_at };
}

function summarize(guests: GuestEntry[]): OwnerGuestList["summary"] {
  return { invited: guests.length, attending: guests.filter((guest) => guest.rsvp === "attending").length,
    notAttending: guests.filter((guest) => guest.rsvp === "not_attending").length,
    awaiting: guests.filter((guest) => guest.rsvp === "pending").length };
}

export class GuestsStore {
  readonly db: Database;
  constructor(db: Database) { this.db = db; }

  private async scope(db: Database, wishlistId: string, ownerId: string, lock = false) {
    const row = await db.get<{ state: string }>(`SELECT w.state FROM wishlists w JOIN memberships m ON m.wishlist_id=w.id
      WHERE w.id=$1 AND m.user_id=$2 AND m.role='owner' ${lock ? 'FOR UPDATE OF w' : ''}`, [wishlistId, ownerId]);
    if (!row) throw new AppError(404, "NOT_FOUND", "Wishlist not found.");
    return row;
  }

  async list(wishlistId: string, ownerId: string): Promise<OwnerGuestList> {
    await this.scope(this.db, wishlistId, ownerId);
    const rows = await this.db.all<Row>(`SELECT id,name,rsvp,expected_arrival,rsvp_updated_at,created_at
      FROM wishlist_guests WHERE wishlist_id=$1 AND removed_at IS NULL ORDER BY lower(name),id LIMIT 1000`, [wishlistId]);
    const guests = rows.map(entry);
    return { summary: summarize(guests), guests };
  }

  async add(wishlistId: string, ownerId: string, name: string): Promise<{ invitePath: string } & OwnerGuestList> {
    const token = randomBytes(24).toString("base64url");
    try {
      await this.db.transaction(async (tx) => {
        const wishlist = await this.scope(tx, wishlistId, ownerId, true);
        if (wishlist.state === "archived") throw new AppError(409, "ARCHIVED", "An archived wishlist cannot take new guests.");
        const count = await tx.get<{ count: string }>("SELECT count(*)::text AS count FROM wishlist_guests WHERE wishlist_id=$1 AND removed_at IS NULL", [wishlistId]);
        if (Number(count?.count) >= 1000) throw new AppError(422, "GUEST_LIMIT", "A wishlist can hold at most 1000 invited guests.");
        const now = new Date().toISOString();
        await tx.run("INSERT INTO wishlist_guests(id,wishlist_id,name,normalized_name,token_hash,created_at) VALUES($1,$2,$3,$4,$5,$6)",
          [randomUUID(), wishlistId, name, name.toLowerCase(), hash(token), now]);
        await tx.run("INSERT INTO audit_entries VALUES($1,$2,$3,'guest_added',NULL,$4,$5)", [randomUUID(), wishlistId, ownerId, name, now]);
      });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "23505" &&
        "constraint" in error && error.constraint === "wishlist_guests_unique_active") {
        throw new AppError(409, "GUEST_EXISTS", "This guest is already on the list.", { name: "Add family or initials to tell two guests with the same name apart." });
      }
      throw error;
    }
    return { invitePath: `/rsvp/${token}`, ...(await this.list(wishlistId, ownerId)) };
  }

  // Adds many guests at once. Names already on the list are reported as duplicates, not errors;
  // every new guest's one-time link is returned so the couple can copy them all immediately.
  async addMany(wishlistId: string, ownerId: string, names: string[]): Promise<BulkGuestResult & OwnerGuestList> {
    const added: BulkGuestResult["added"] = [];
    await this.db.transaction(async (tx) => {
      const wishlist = await this.scope(tx, wishlistId, ownerId, true);
      if (wishlist.state === "archived") throw new AppError(409, "ARCHIVED", "An archived wishlist cannot take new guests.");
      const existing = await tx.all<{ normalized_name: string }>("SELECT normalized_name FROM wishlist_guests WHERE wishlist_id=$1 AND removed_at IS NULL", [wishlistId]);
      const taken = new Set(existing.map((row) => row.normalized_name));
      const fresh = names.filter((name) => !taken.has(name.toLowerCase()));
      const count = await tx.get<{ count: string }>("SELECT count(*)::text AS count FROM wishlist_guests WHERE wishlist_id=$1 AND removed_at IS NULL", [wishlistId]);
      if (Number(count?.count) + fresh.length > 1000) throw new AppError(422, "GUEST_LIMIT", "A wishlist can hold at most 1000 invited guests.");
      const now = new Date().toISOString();
      for (const name of fresh) {
        const token = randomBytes(24).toString("base64url");
        await tx.run("INSERT INTO wishlist_guests(id,wishlist_id,name,normalized_name,token_hash,created_at) VALUES($1,$2,$3,$4,$5,$6)",
          [randomUUID(), wishlistId, name, name.toLowerCase(), hash(token), now]);
        added.push({ name, invitePath: `/rsvp/${token}` });
      }
      if (fresh.length) {
        await tx.run("INSERT INTO audit_entries VALUES($1,$2,$3,'guests_added',NULL,$4,$5)", [randomUUID(), wishlistId, ownerId, String(fresh.length), now]);
      }
    });
    const duplicates = names.filter((name) => !added.some((entry) => entry.name.toLowerCase() === name.toLowerCase()));
    return { added, duplicates, ...(await this.list(wishlistId, ownerId)) };
  }

  async remove(wishlistId: string, guestId: string, ownerId: string): Promise<OwnerGuestList> {
    await this.db.transaction(async (tx) => {
      const wishlist = await this.scope(tx, wishlistId, ownerId, true);
      if (wishlist.state === "archived") throw new AppError(409, "ARCHIVED", "Archived guest lists are read-only.");
      const guest = await tx.get<{ id: string; name: string; removed_at: string | null }>("SELECT id,name,removed_at FROM wishlist_guests WHERE id=$1 AND wishlist_id=$2", [guestId, wishlistId]);
      if (!guest || guest.removed_at) throw new AppError(404, "NOT_FOUND", "Guest not found.");
      const now = new Date().toISOString();
      await tx.run("UPDATE wishlist_guests SET removed_at=$1,rsvp='pending',expected_arrival=NULL,rsvp_updated_at=NULL WHERE id=$2", [now, guest.id]);
      await tx.run("INSERT INTO audit_entries VALUES($1,$2,$3,'guest_removed',NULL,$4,$5)", [randomUUID(), wishlistId, ownerId, guest.name, now]);
    });
    return this.list(wishlistId, ownerId);
  }

  // Rotates the private link: the old link stops working and the new token is shown exactly once.
  async resetInvite(wishlistId: string, guestId: string, ownerId: string): Promise<{ invitePath: string } & OwnerGuestList> {
    const token = randomBytes(24).toString("base64url");
    await this.db.transaction(async (tx) => {
      const wishlist = await this.scope(tx, wishlistId, ownerId, true);
      if (wishlist.state === "archived") throw new AppError(409, "ARCHIVED", "Archived guest lists are read-only.");
      const guest = await tx.get<{ id: string }>("SELECT id FROM wishlist_guests WHERE id=$1 AND wishlist_id=$2 AND removed_at IS NULL", [guestId, wishlistId]);
      if (!guest) throw new AppError(404, "NOT_FOUND", "Guest not found.");
      await tx.run("UPDATE wishlist_guests SET token_hash=$1 WHERE id=$2", [hash(token), guest.id]);
      await tx.run("INSERT INTO audit_entries VALUES($1,$2,$3,'guest_invite_reset',NULL,$4,$5)", [randomUUID(), wishlistId, ownerId, guestId, new Date().toISOString()]);
    });
    return { invitePath: `/rsvp/${token}`, ...(await this.list(wishlistId, ownerId)) };
  }

  async recordAnswer(wishlistId: string, guestId: string, ownerId: string, input: HostRsvpUpdate): Promise<OwnerGuestList> {
    await this.db.transaction(async (tx) => {
      const wishlist = await this.scope(tx, wishlistId, ownerId, true);
      if (wishlist.state === "archived") throw new AppError(409, "ARCHIVED", "Archived guest lists are read-only.");
      const guest = await tx.get<Row>("SELECT id,name,rsvp,expected_arrival,rsvp_updated_at,created_at FROM wishlist_guests WHERE id=$1 AND wishlist_id=$2 AND removed_at IS NULL FOR UPDATE", [guestId, wishlistId]);
      if (!guest) throw new AppError(404, "NOT_FOUND", "Guest not found.");
      if (guest.rsvp_updated_at !== input.previousUpdatedAt) throw new AppError(409, "STALE", "This guest's answer changed. Refresh the guest list before saving.");
      const arrival = input.rsvp === "attending" ? input.expectedArrival : null;
      if (guest.rsvp === input.rsvp && guest.expected_arrival === arrival) throw new AppError(409, "NO_CHANGE", "These details are already saved.");
      const now = new Date(Math.max(Date.now(), Date.parse(guest.rsvp_updated_at ?? "") + 1 || 0)).toISOString();
      await tx.run("UPDATE wishlist_guests SET rsvp=$1,expected_arrival=$2,rsvp_updated_at=$3 WHERE id=$4", [input.rsvp, arrival, now, guestId]);
      await tx.run("INSERT INTO audit_entries VALUES($1,$2,$3,'host_rsvp_recorded',NULL,$4,$5)", [randomUUID(), wishlistId, ownerId, JSON.stringify({ guestId, before: { rsvp: guest.rsvp, expectedArrival: guest.expected_arrival }, after: { rsvp: input.rsvp, expectedArrival: arrival }, source: input.reason }), now]);
    });
    return this.list(wishlistId, ownerId);
  }

  private async rowByToken(db: Database, token: string, lock = false) {
    const row = await db.get<Row & { wishlist_id: string; display_names: string; wedding_date: string | null; state: string; visibility: string; expires_at: string | null }>(`SELECT g.id,g.wishlist_id,g.name,g.rsvp,g.expected_arrival,g.rsvp_updated_at,g.created_at,
      w.display_names,w.wedding_date,w.state,w.visibility,w.expires_at FROM wishlist_guests g
      JOIN wishlists w ON w.id=g.wishlist_id WHERE g.token_hash=$1 AND g.removed_at IS NULL ${lock ? "FOR UPDATE OF g" : ""}`, [hash(token)]);
    if (!row || row.visibility === "private" || !["published", "paused", "closed"].includes(row.state)) {
      throw new AppError(404, "NOT_FOUND", "This RSVP link is not available. Ask the couple for a fresh link.");
    }
    return row;
  }

  async view(token: string): Promise<RsvpView> {
    if (!/^[A-Za-z0-9_-]{32}$/.test(token)) throw new AppError(404, "NOT_FOUND", "This RSVP link is not available.");
    const row = await this.rowByToken(this.db, token);
    const open = row.state === "published" && (!row.expires_at || row.expires_at > new Date().toISOString());
    return { displayNames: row.display_names, weddingDate: row.wedding_date, name: row.name,
      rsvp: row.rsvp, expectedArrival: row.expected_arrival, open };
  }

  async answer(token: string, input: { rsvp: GuestRsvp; expectedArrival: string | null }): Promise<RsvpView> {
    if (!/^[A-Za-z0-9_-]{32}$/.test(token)) throw new AppError(404, "NOT_FOUND", "This RSVP link is not available.");
    await this.db.transaction(async (tx) => {
      const row = await this.rowByToken(tx, token, true);
      const now = new Date(Math.max(Date.now(), Date.parse(row.rsvp_updated_at ?? "") + 1 || 0)).toISOString();
      if (row.state !== "published" || (row.expires_at && row.expires_at <= now)) {
        throw new AppError(409, "CLOSED", "This wedding's RSVP is closed. Reach the couple directly for changes.");
      }
      const arrival = input.rsvp === "attending" ? input.expectedArrival : null;
      if (row.rsvp === input.rsvp && row.expected_arrival === arrival) throw new AppError(409, "NO_CHANGE", "These details are already saved.");
      // No audit entry here: the answering guest is not an app user, and rsvp_updated_at records the change.
      await tx.run("UPDATE wishlist_guests SET rsvp=$1,expected_arrival=$2,rsvp_updated_at=$3 WHERE id=$4", [input.rsvp, arrival, now, row.id]);
    });
    return this.view(token);
  }
}
