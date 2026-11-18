import { randomUUID } from "node:crypto";
import type { Database } from "./database.ts";
import { AppError } from "../lib/errors.ts";
import { availability, assertTransition } from "../lib/wishlist.ts";
import type { NewWishlist, OwnerWishlist, PublicWishlist, Visibility, WishlistState } from "../lib/wishlist.ts";

type WishlistRow = {
  id: string; slug: string; display_names: string; story: string;
  wedding_date: string | null; expires_at: string | null;
  visibility: Visibility; state: WishlistState; version: number;
};
type GoalRow = { id: string; title: string; description: string; target_paise: string; confirmed_paise: string };
export function integer(value: unknown): number {
  const number = Number(value);
  if ((typeof value !== "string" && typeof value !== "number") || !Number.isSafeInteger(number)) {
    throw new Error("Database returned an unsafe integer.");
  }
  return number;
}

export class WishlistStore {
  readonly db: Database;
  constructor(db: Database) { this.db = db; }

  private async row(id: string, ownerId: string, lock = false): Promise<WishlistRow> {
    const row = await this.db.get<WishlistRow>(`SELECT w.id,w.slug,w.display_names,w.story,w.wedding_date,
      w.expires_at,w.visibility,w.state,w.version FROM wishlists w
      JOIN memberships m ON m.wishlist_id=w.id WHERE w.id=$1 AND m.user_id=$2 AND m.role='owner'
      ${lock ? "FOR UPDATE OF w" : ""}`, [id, ownerId]);
    if (!row) throw new AppError(404, "NOT_FOUND", "Wishlist not found.");
    return row;
  }

  private async project(row: WishlistRow): Promise<PublicWishlist> {
    const goals = await this.db.all<GoalRow>(`SELECT g.id,g.title,g.description,g.target_paise,
      COALESCE(SUM(e.confirmed_delta_paise),0) AS confirmed_paise FROM goals g
      LEFT JOIN contributions c ON c.goal_id=g.id LEFT JOIN claim_events e ON e.contribution_id=c.id
      WHERE g.wishlist_id=$1 GROUP BY g.id ORDER BY g.position`, [row.id]);
    const recipient = await this.db.get<{ id: string; label: string }>("SELECT id,label FROM recipient_snapshots WHERE wishlist_id=$1", [row.id]);
    return {
      slug: row.slug, displayNames: row.display_names, story: row.story,
      weddingDate: row.wedding_date, expiresAt: row.expires_at,
      availability: availability(row.state, row.expires_at, new Date().toISOString()),
      currency: "INR", paymentMode: "demo",
      recipientSnapshot: recipient ? { id: recipient.id, label: recipient.label, mode: "demo" } : null,
      goals: goals.map((goal) => ({
        id: goal.id, title: goal.title, description: goal.description,
        targetPaise: integer(goal.target_paise), confirmedPaise: integer(goal.confirmed_paise)
      }))
    };
  }

  async getOwner(id: string, ownerId: string): Promise<OwnerWishlist> {
    const row = await this.row(id, ownerId);
    return { ...await this.project(row), id: row.id, state: row.state, visibility: row.visibility, version: row.version };
  }

  async listOwner(ownerId: string): Promise<{ id: string; displayNames: string; slug: string; state: WishlistState }[]> {
    const rows = await this.db.all<Pick<WishlistRow, "id" | "display_names" | "slug" | "state">>(`SELECT w.id,w.display_names,w.slug,w.state FROM wishlists w
      JOIN memberships m ON m.wishlist_id=w.id WHERE m.user_id=$1 ORDER BY w.created_at DESC,w.id`, [ownerId]);
    return rows.map((row) => ({ id: row.id, displayNames: row.display_names, slug: row.slug, state: row.state }));
  }

  async getPublic(slug: string, lock = false): Promise<PublicWishlist> {
    const row = await this.db.get<WishlistRow>(`SELECT id,slug,display_names,story,wedding_date,expires_at,
      visibility,state,version FROM wishlists WHERE slug=$1 AND state IN ('published','paused','closed')
      AND visibility IN ('public','unlisted') ${lock ? "FOR UPDATE" : ""}`, [slug]);
    if (!row) throw new AppError(404, "NOT_FOUND", "Wishlist not available.");
    return this.project(row);
  }

  async create(ownerId: string, input: NewWishlist): Promise<OwnerWishlist> {
    const id = randomUUID();
    const now = new Date().toISOString();
    try {
      await this.db.transaction(async (tx) => {
        await tx.run(`INSERT INTO wishlists(id,slug,display_names,story,wedding_date,expires_at,
          visibility,state,currency,payment_mode,funding_policy,created_at,updated_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,'draft','INR','demo','undecided',$8,$8)`,
        [id, input.slug, input.displayNames, input.story, input.weddingDate, input.expiresAt, input.visibility, now]);
        await tx.run("INSERT INTO memberships VALUES($1,$2,'owner')", [id, ownerId]);
        await tx.run("INSERT INTO recipient_snapshots VALUES($1,$2,$3,'demo',$4)", [randomUUID(), id, input.displayNames, now]);
        for (const [position, goal] of input.goals.entries()) {
          await tx.run("INSERT INTO goals VALUES($1,$2,$3,$4,$5,$6)", [randomUUID(), id, goal.title, goal.description, goal.targetPaise, position]);
        }
        await tx.run("INSERT INTO audit_entries VALUES($1,$2,$3,'created',NULL,'draft',$4)", [randomUUID(), id, ownerId, now]);
      });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "23505" &&
        "constraint" in error && error.constraint === "wishlists_slug_key") {
        throw new AppError(409, "SLUG_TAKEN", "This share slug is already in use.", { slug: "Choose another slug." });
      }
      throw error;
    }
    return this.getOwner(id, ownerId);
  }

  async transition(id: string, ownerId: string, to: unknown, expectedVersion: unknown): Promise<OwnerWishlist> {
    if (!Number.isSafeInteger(expectedVersion) || Number(expectedVersion) < 1) throw new AppError(422, "VALIDATION", "A valid version is required.");
    await this.db.transaction(async (tx) => {
      const row = await new WishlistStore(tx).row(id, ownerId, true);
      if (row.version !== expectedVersion) throw new AppError(409, "STALE_VERSION", "This wishlist changed in another tab. Refresh before trying again.");
      assertTransition(row.state, to);
      if (to === "published" && row.expires_at && row.expires_at <= new Date().toISOString()) throw new AppError(409, "EXPIRED", "An expired wishlist cannot be published.");
      const now = new Date().toISOString();
      await tx.run("UPDATE wishlists SET state=$1,version=version+1,updated_at=$2 WHERE id=$3", [to, now, id]);
      await tx.run("INSERT INTO audit_entries VALUES($1,$2,$3,'state_changed',$4,$5,$6)", [randomUUID(), id, ownerId, row.state, to, now]);
    });
    return this.getOwner(id, ownerId);
  }
}
