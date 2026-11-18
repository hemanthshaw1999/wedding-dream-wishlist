import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { AppError } from "../lib/errors.ts";
import { assertClaimTransition } from "../lib/claims.ts";
import type { ClaimDashboard, ClaimReceipt, ClaimStatus, NewClaim, OwnerClaim } from "../lib/claims.ts";
import { WishlistStore } from "./store.ts";

type ClaimRow = {
  id: string; status: ClaimStatus; amount_paise: number; goal_title: string; recipient_label: string;
  token_expires_at: string; guest_name: string; guest_message: string; reference: string;
  version: number; created_at: string; duplicate_reference: number; request_hash: string; wishlist_id: string;
};
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const selection = `SELECT c.*, g.title AS goal_title, r.label AS recipient_label,
  CASE WHEN c.reference<>'' AND EXISTS(SELECT 1 FROM contributions other
    WHERE other.wishlist_id=c.wishlist_id AND other.reference=c.reference AND other.id<>c.id)
    THEN 1 ELSE 0 END AS duplicate_reference
  FROM contributions c JOIN goals g ON g.id=c.goal_id
  JOIN recipient_snapshots r ON r.id=c.recipient_snapshot_id`;

function receipt(row: ClaimRow): ClaimReceipt {
  return {
    id: row.id, status: row.status, amountPaise: row.amount_paise, currency: "INR",
    goalTitle: row.goal_title, recipientLabel: row.recipient_label,
    tokenExpiresAt: row.token_expires_at, mode: "demo"
  };
}
function ownerClaim(row: ClaimRow): OwnerClaim {
  return {
    ...receipt(row), guestName: row.guest_name, guestMessage: row.guest_message,
    reference: row.reference, duplicateReference: Boolean(row.duplicate_reference),
    version: row.version, createdAt: row.created_at
  };
}

export class ClaimsStore {
  readonly db: DatabaseSync;
  constructor(db: DatabaseSync) { this.db = db; }

  report(slug: string, input: NewClaim): ClaimReceipt {
    const tokenHash = hash(input.token);
    const { token: _token, ...terms } = input;
    void _token;
    const requestHash = hash(JSON.stringify({ slug, ...terms }));
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const previous = this.db.prepare(`${selection} WHERE c.token_hash=?`).get(tokenHash) as ClaimRow | undefined;
      if (previous) {
        if (previous.request_hash !== requestHash) throw new AppError(409, "KEY_REUSED", "This private key already belongs to a different report. Check its private status before creating another.");
        this.db.exec("COMMIT");
        return receipt(previous);
      }
      const wishlist = new WishlistStore(this.db).getPublic(slug);
      if (wishlist.availability !== "available") throw new AppError(409, "UNAVAILABLE", "This wishlist is not accepting demo reports.");
      const recipient = wishlist.recipientSnapshot;
      if (!recipient || recipient.id !== input.recipientSnapshotId) throw new AppError(409, "STALE_RECIPIENT", "Recipient instructions changed. Refresh and review before submitting.");
      if (!wishlist.goals.some((goal) => goal.id === input.goalId)) throw new AppError(422, "GOAL_MISMATCH", "This goal does not belong to the wishlist.");
      const source = this.db.prepare("SELECT id FROM wishlists WHERE slug=?").get(slug);
      const wishlistId = String(source?.id);
      const duplicate = input.reference && this.db.prepare("SELECT id FROM contributions WHERE wishlist_id=? AND reference=? LIMIT 1").get(wishlistId, input.reference);
      const status: ClaimStatus = duplicate ? "needs_review" : "reported";
      const id = randomUUID();
      const now = new Date().toISOString();
      const expiry = new Date(Date.now() + 7 * 86_400_000).toISOString();
      this.db.prepare(`INSERT INTO contributions(id,wishlist_id,goal_id,recipient_snapshot_id,
        amount_paise,currency,guest_name,guest_message,reference,status,token_hash,request_hash,
        token_expires_at,version,created_at,updated_at) VALUES(?,?,?,?,?,'INR',?,?,?,?,?,?,?,1,?,?)`).run(
        id, wishlistId, input.goalId, recipient.id, input.amountPaise,
        input.guestName, input.guestMessage, input.reference, status, tokenHash, requestHash, expiry, now, now
      );
      this.db.prepare("INSERT INTO claim_events VALUES(?,?,NULL,NULL,?,0,?,?)").run(
        randomUUID(), id, status, duplicate ? "Duplicate reference; review required. Reference is not proof." : "Guest declaration only; not verified.", now
      );
      const row = this.db.prepare(`${selection} WHERE c.id=?`).get(id) as ClaimRow;
      this.db.exec("COMMIT");
      return receipt(row);
    } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw error; }
  }

  status(token: unknown): ClaimReceipt {
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) throw new AppError(404, "NOT_FOUND", "Private report not available.");
    const row = this.db.prepare(`${selection} WHERE c.token_hash=? AND c.token_expires_at>?`).get(hash(token), new Date().toISOString()) as ClaimRow | undefined;
    if (!row) throw new AppError(404, "NOT_FOUND", "Private report not available or link expired.");
    return receipt(row);
  }

  dashboard(wishlistId: string, ownerId: string, filter = "all", page = 1): ClaimDashboard {
    new WishlistStore(this.db).getOwner(wishlistId, ownerId);
    if (!["all", "reported", "needs_review", "owner_confirmed", "rejected"].includes(filter) ||
      !Number.isSafeInteger(page) || page < 1 || page > 10000) throw new AppError(422, "VALIDATION", "Invalid report filter or page.");
    const params = filter === "all" ? [wishlistId] : [wishlistId, filter];
    const where = `c.wishlist_id=?${filter === "all" ? "" : " AND c.status=?"}`;
    const rows = this.db.prepare(`${selection} WHERE ${where} ORDER BY c.created_at DESC,c.id LIMIT 50 OFFSET ?`).all(...params, (page - 1) * 50) as ClaimRow[];
    const count = this.db.prepare(`SELECT COUNT(*) AS count FROM contributions c WHERE ${where}`).get(...params);
    const sums = this.db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN status='reported' THEN amount_paise ELSE 0 END),0) AS reported,
      COALESCE(SUM(CASE WHEN status='needs_review' THEN amount_paise ELSE 0 END),0) AS review,
      COALESCE(SUM(CASE WHEN status='owner_confirmed' THEN amount_paise ELSE 0 END),0) AS confirmed,
      COALESCE(SUM(CASE WHEN status='rejected' THEN amount_paise ELSE 0 END),0) AS rejected
      FROM contributions WHERE wishlist_id=?`).get(wishlistId);
    return {
      claims: rows.map(ownerClaim), total: Number(count?.count), page,
      totals: { reportedPaise: Number(sums?.reported), needsReviewPaise: Number(sums?.review), ownerConfirmedPaise: Number(sums?.confirmed), rejectedPaise: Number(sums?.rejected) }
    };
  }

  resolve(wishlistId: string, id: string, ownerId: string, to: unknown, version: unknown, reason: unknown): OwnerClaim {
    if (!Number.isSafeInteger(version) || Number(version) < 1 || typeof reason !== "string" || !reason.trim() || reason.trim().length > 300) {
      throw new AppError(422, "VALIDATION", "A current version and a reason of 1-300 characters are required.");
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      new WishlistStore(this.db).getOwner(wishlistId, ownerId);
      const row = this.db.prepare(`${selection} WHERE c.wishlist_id=? AND c.id=?`).get(wishlistId, id) as ClaimRow | undefined;
      if (!row) throw new AppError(404, "NOT_FOUND", "Report not found.");
      if (row.version !== version) throw new AppError(409, "STALE_VERSION", "Another action changed this report. Refresh before trying again.");
      assertClaimTransition(row.status, to);
      const delta = (to === "owner_confirmed" ? row.amount_paise : 0) - (row.status === "owner_confirmed" ? row.amount_paise : 0);
      const net = Number(this.db.prepare("SELECT COALESCE(SUM(confirmed_delta_paise),0) AS net FROM claim_events WHERE contribution_id=?").get(id)?.net);
      if (net + delta < 0 || net + delta > row.amount_paise) throw new AppError(409, "LEDGER_MISMATCH", "Report history needs review; no totals were changed.");
      const now = new Date().toISOString();
      this.db.prepare("UPDATE contributions SET status=?,version=version+1,updated_at=? WHERE id=? AND version=?").run(to, now, id, Number(version));
      this.db.prepare("INSERT INTO claim_events VALUES(?,?,?,?,?,?,?,?)").run(randomUUID(), id, ownerId, row.status, to, delta, reason.trim(), now);
      const updated = this.db.prepare(`${selection} WHERE c.id=?`).get(id) as ClaimRow;
      this.db.exec("COMMIT");
      return ownerClaim(updated);
    } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw error; }
  }
}
