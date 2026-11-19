import { randomUUID } from "node:crypto";
import type { Database } from "./database.ts";
import { AppError } from "../lib/errors.ts";
import { parseINR } from "../lib/money.ts";
import { integer } from "./store.ts";

export type CashGift = {
  id: string; goalId: string; goalTitle: string; amountPaise: number; donorName: string; note: string;
  createdAt: string; voidedAt: string | null;
};
type Row = { id: string; goal_id: string; goal_title: string; amount_paise: string; donor_name: string; note: string; created_at: string; voided_at: string | null };

export function validateCashGift(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new AppError(422, "VALIDATION", "Expected a cash gift object.");
  const data = input as Record<string, unknown>;
  if (Object.keys(data).some((key) => !["goalId", "amount", "donorName", "note"].includes(key))) {
    throw new AppError(422, "VALIDATION", "Send only goalId, amount, donorName and note.");
  }
  const text = (value: unknown, limit: number, label: string) => {
    if (value === undefined) return "";
    if (typeof value !== "string" || value.trim().length > limit) throw new AppError(422, "VALIDATION", `Check ${label} (maximum ${limit} characters).`);
    return value.trim();
  };
  const amountPaise = parseINR(data.amount);
  if (amountPaise < 100 || amountPaise > 10_000_000) throw new AppError(422, "INVALID_AMOUNT", "Add between INR 1 and INR 1,00,000 per cash gift.");
  const goalId = text(data.goalId, 64, "goal");
  if (!goalId) throw new AppError(422, "VALIDATION", "Choose a goal.");
  return { goalId, amountPaise, donorName: text(data.donorName, 100, "name"), note: text(data.note, 300, "note") };
}

export class CashStore {
  readonly db: Database;
  constructor(db: Database) { this.db = db; }

  private async scope(db: Database, wishlistId: string, ownerId: string) {
    const row = await db.get<{ state: string }>(`SELECT w.state FROM wishlists w JOIN memberships m ON m.wishlist_id=w.id
      WHERE w.id=$1 AND m.user_id=$2 AND m.role='owner'`, [wishlistId, ownerId]);
    if (!row) throw new AppError(404, "NOT_FOUND", "Wishlist not found.");
    return row;
  }

  async list(wishlistId: string, ownerId: string): Promise<CashGift[]> {
    await this.scope(this.db, wishlistId, ownerId);
    const rows = await this.db.all<Row>(`SELECT k.id,k.goal_id,g.title AS goal_title,k.amount_paise::text,k.donor_name,k.note,
      k.created_at,k.voided_at FROM cash_gifts k JOIN goals g ON g.id=k.goal_id WHERE k.wishlist_id=$1
      ORDER BY k.created_at DESC,k.id LIMIT 200`, [wishlistId]);
    return rows.map((row) => ({ id: row.id, goalId: row.goal_id, goalTitle: row.goal_title, amountPaise: integer(row.amount_paise),
      donorName: row.donor_name, note: row.note, createdAt: row.created_at, voidedAt: row.voided_at }));
  }

  async add(wishlistId: string, ownerId: string, input: ReturnType<typeof validateCashGift>): Promise<CashGift[]> {
    await this.db.transaction(async (tx) => {
      const wishlist = await this.scope(tx, wishlistId, ownerId);
      if (wishlist.state === "archived") throw new AppError(409, "ARCHIVED", "An archived wishlist cannot take new entries.");
      const goal = await tx.get<{ archived_at: string | null }>("SELECT archived_at FROM goals WHERE id=$1 AND wishlist_id=$2", [input.goalId, wishlistId]);
      if (!goal) throw new AppError(404, "NOT_FOUND", "Goal not found.");
      if (goal.archived_at) throw new AppError(409, "ARCHIVED", "This goal is archived and cannot take new entries.");
      const now = new Date().toISOString();
      await tx.run("INSERT INTO cash_gifts(id,wishlist_id,goal_id,amount_paise,donor_name,note,actor_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [randomUUID(), wishlistId, input.goalId, input.amountPaise, input.donorName, input.note, ownerId, now]);
      await tx.run("INSERT INTO audit_entries VALUES($1,$2,$3,'cash_gift_added',NULL,$4,$5)", [randomUUID(), wishlistId, ownerId, `${input.goalId}:${input.amountPaise}`, now]);
    });
    return this.list(wishlistId, ownerId);
  }

  async void(wishlistId: string, giftId: string, ownerId: string): Promise<CashGift[]> {
    await this.db.transaction(async (tx) => {
      await this.scope(tx, wishlistId, ownerId);
      const gift = await tx.get<{ voided_at: string | null }>("SELECT voided_at FROM cash_gifts WHERE id=$1 AND wishlist_id=$2 FOR UPDATE", [giftId, wishlistId]);
      if (!gift) throw new AppError(404, "NOT_FOUND", "Cash gift not found.");
      if (gift.voided_at) throw new AppError(409, "ALREADY_VOIDED", "This entry is already voided.");
      const now = new Date().toISOString();
      await tx.run("UPDATE cash_gifts SET voided_at=$1 WHERE id=$2", [now, giftId]);
      await tx.run("INSERT INTO audit_entries VALUES($1,$2,$3,'cash_gift_voided',NULL,$4,$5)", [randomUUID(), wishlistId, ownerId, giftId, now]);
    });
    return this.list(wishlistId, ownerId);
  }
}
