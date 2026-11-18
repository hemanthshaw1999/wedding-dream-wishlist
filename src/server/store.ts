import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { AppError } from "../lib/errors.ts";
import { availability, assertTransition } from "../lib/wishlist.ts";
import type { NewWishlist, OwnerWishlist, PublicWishlist, Visibility, WishlistState } from "../lib/wishlist.ts";

type WishlistRow = {
  id: string; slug: string; display_names: string; story: string;
  wedding_date: string | null; expires_at: string | null;
  visibility: Visibility; state: WishlistState; version: number;
};
type GoalRow = { id: string; title: string; description: string; target_paise: number; confirmed_paise: number };

export class WishlistStore {
  readonly db: DatabaseSync;
  constructor(db: DatabaseSync) { this.db = db; }

  private row(id: string, ownerId: string): WishlistRow {
    const row = this.db.prepare(`SELECT w.id, w.slug, w.display_names, w.story, w.wedding_date,
      w.expires_at, w.visibility, w.state, w.version FROM wishlists w
      JOIN memberships m ON m.wishlist_id=w.id WHERE w.id=? AND m.user_id=? AND m.role='owner'`).get(id, ownerId) as WishlistRow | undefined;
    if (!row) throw new AppError(404, "NOT_FOUND", "Wishlist not found.");
    return row;
  }

  private project(row: WishlistRow): PublicWishlist {
    const goals = this.db.prepare(`SELECT g.id,g.title,g.description,g.target_paise,
      COALESCE(SUM(e.confirmed_delta_paise),0) AS confirmed_paise FROM goals g
      LEFT JOIN contributions c ON c.goal_id=g.id
      LEFT JOIN claim_events e ON e.contribution_id=c.id
      WHERE g.wishlist_id=? GROUP BY g.id ORDER BY g.position`).all(row.id) as GoalRow[];
    const recipient = this.db.prepare("SELECT id,label FROM recipient_snapshots WHERE wishlist_id=?").get(row.id);
    return {
      slug: row.slug, displayNames: row.display_names, story: row.story,
      weddingDate: row.wedding_date, expiresAt: row.expires_at,
      availability: availability(row.state, row.expires_at, new Date().toISOString()),
      currency: "INR", paymentMode: "demo",
      recipientSnapshot: recipient ? { id: String(recipient.id), label: String(recipient.label), mode: "demo" } : null,
      goals: goals.map((goal) => ({
        id: goal.id, title: goal.title, description: goal.description,
        targetPaise: goal.target_paise, confirmedPaise: goal.confirmed_paise
      }))
    };
  }

  getOwner(id: string, ownerId: string): OwnerWishlist {
    const row = this.row(id, ownerId);
    return { ...this.project(row), id: row.id, state: row.state, visibility: row.visibility, version: row.version };
  }

  listOwner(ownerId: string): { id: string; displayNames: string; slug: string; state: WishlistState }[] {
    const rows = this.db.prepare(`SELECT w.id, w.display_names, w.slug, w.state FROM wishlists w
      JOIN memberships m ON m.wishlist_id=w.id WHERE m.user_id=? ORDER BY w.created_at DESC, w.id`).all(ownerId);
    return rows.map((row) => ({
      id: String(row.id), displayNames: String(row.display_names), slug: String(row.slug), state: row.state as WishlistState
    }));
  }

  getPublic(slug: string): PublicWishlist {
    const row = this.db.prepare(`SELECT id, slug, display_names, story, wedding_date, expires_at,
      visibility, state, version FROM wishlists WHERE slug=? AND state IN ('published','paused','closed')
      AND visibility IN ('public','unlisted')`).get(slug) as WishlistRow | undefined;
    if (!row) throw new AppError(404, "NOT_FOUND", "Wishlist not available.");
    return this.project(row);
  }

  create(ownerId: string, input: NewWishlist): OwnerWishlist {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (this.db.prepare("SELECT id FROM wishlists WHERE slug=?").get(input.slug)) {
        throw new AppError(409, "SLUG_TAKEN", "This share slug is already in use.", { slug: "Choose another slug." });
      }
      this.db.prepare(`INSERT INTO wishlists(id,slug,display_names,story,wedding_date,expires_at,
        visibility,state,currency,payment_mode,funding_policy,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,'draft','INR','demo','undecided',?,?)`).run(
        id, input.slug, input.displayNames, input.story, input.weddingDate, input.expiresAt, input.visibility, now, now
      );
      this.db.prepare("INSERT INTO memberships VALUES(?,?,'owner')").run(id, ownerId);
      this.db.prepare("INSERT INTO recipient_snapshots VALUES(?,?,?,'demo',?)").run(randomUUID(), id, input.displayNames, now);
      const insert = this.db.prepare("INSERT INTO goals VALUES(?,?,?,?,?,?)");
      input.goals.forEach((goal, position) => insert.run(randomUUID(), id, goal.title, goal.description, goal.targetPaise, position));
      this.db.prepare("INSERT INTO audit_entries VALUES(?,?,?,'created',NULL,'draft',?)").run(randomUUID(), id, ownerId, now);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return this.getOwner(id, ownerId);
  }

  transition(id: string, ownerId: string, to: unknown, expectedVersion: unknown): OwnerWishlist {
    if (!Number.isSafeInteger(expectedVersion) || Number(expectedVersion) < 1) throw new AppError(422, "VALIDATION", "A valid version is required.");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.row(id, ownerId);
      if (row.version !== expectedVersion) throw new AppError(409, "STALE_VERSION", "This wishlist changed in another tab. Refresh before trying again.");
      assertTransition(row.state, to);
      if (to === "published" && row.expires_at && row.expires_at <= new Date().toISOString()) {
        throw new AppError(409, "EXPIRED", "An expired wishlist cannot be published.");
      }
      const now = new Date().toISOString();
      this.db.prepare("UPDATE wishlists SET state=?,version=version+1,updated_at=? WHERE id=? AND version=?").run(to, now, id, expectedVersion as number);
      this.db.prepare("INSERT INTO audit_entries VALUES(?,?,?,'state_changed',?,?,?)").run(randomUUID(), id, ownerId, row.state, to, now);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return this.getOwner(id, ownerId);
  }
}
