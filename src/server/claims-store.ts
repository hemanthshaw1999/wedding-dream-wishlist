import { createHash, randomUUID } from "node:crypto";
import type { Database } from "./database.ts";
import { AppError } from "../lib/errors.ts";
import { assertClaimTransition } from "../lib/claims.ts";
import type { ClaimDashboard, ClaimReceipt, ClaimStatus, NewClaim, OwnerClaim } from "../lib/claims.ts";
import { integer, WishlistStore } from "./store.ts";

type ClaimRow = {
  id: string; status: ClaimStatus; amount_paise: string; goal_title: string; recipient_label: string;
  token_expires_at: string; guest_name: string; guest_message: string; reference: string;
  version: number; created_at: string; duplicate_reference: number; request_hash: string; wishlist_id: string;
};
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const selection = `SELECT c.*,g.title AS goal_title,r.label AS recipient_label,
  CASE WHEN c.reference<>'' AND EXISTS(SELECT 1 FROM contributions other
    WHERE other.wishlist_id=c.wishlist_id AND other.reference=c.reference AND other.id<>c.id)
    THEN 1 ELSE 0 END AS duplicate_reference FROM contributions c JOIN goals g ON g.id=c.goal_id
  JOIN recipient_snapshots r ON r.id=c.recipient_snapshot_id`;
function receipt(row: ClaimRow): ClaimReceipt {
  return { id: row.id, status: row.status, amountPaise: integer(row.amount_paise), currency: "INR",
    goalTitle: row.goal_title, recipientLabel: row.recipient_label, tokenExpiresAt: row.token_expires_at, mode: "demo" };
}
function ownerClaim(row: ClaimRow): OwnerClaim {
  return { ...receipt(row), guestName: row.guest_name, guestMessage: row.guest_message,
    reference: row.reference, duplicateReference: Boolean(row.duplicate_reference), version: row.version, createdAt: row.created_at };
}

export class ClaimsStore {
  readonly db: Database;
  constructor(db: Database) { this.db = db; }

  async report(slug: string, input: NewClaim): Promise<ClaimReceipt> {
    const tokenHash = hash(input.token);
    const { token: _token, ...terms } = input;
    void _token;
    const requestHash = hash(JSON.stringify({ slug, ...terms }));
    return this.db.transaction(async (tx) => {
      await tx.run("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [tokenHash]);
      const previous = await tx.get<ClaimRow>(`${selection} WHERE c.token_hash=$1`, [tokenHash]);
      if (previous) {
        if (previous.request_hash !== requestHash) throw new AppError(409, "KEY_REUSED", "This private key already belongs to a different report. Check its private status before creating another.");
        return receipt(previous);
      }
      const wishlist = await new WishlistStore(tx).getPublic(slug, true);
      if (wishlist.availability !== "available") throw new AppError(409, "UNAVAILABLE", "This wishlist is not accepting demo reports.");
      const recipient = wishlist.recipientSnapshot;
      if (!recipient || recipient.id !== input.recipientSnapshotId) throw new AppError(409, "STALE_RECIPIENT", "Recipient instructions changed. Refresh and review before submitting.");
      const goal = wishlist.goals.find((goal) => goal.id === input.goalId);
      if (!goal) throw new AppError(422, "GOAL_MISMATCH", "This goal does not belong to the wishlist.");
      if (goal.archivedAt) throw new AppError(409, "ARCHIVED", "This goal is archived and cannot accept new reports.");
      const source = await tx.get<{ id: string }>("SELECT id FROM wishlists WHERE slug=$1", [slug]);
      if (!source) throw new AppError(409, "UNAVAILABLE", "Wishlist is no longer available.");
      const duplicate = input.reference && await tx.get("SELECT id FROM contributions WHERE wishlist_id=$1 AND reference=$2 LIMIT 1", [source.id, input.reference]);
      const status: ClaimStatus = duplicate ? "needs_review" : "reported";
      const id = randomUUID();
      const now = new Date().toISOString();
      const expiry = new Date(Date.now() + 7 * 86_400_000).toISOString();
      await tx.run(`INSERT INTO contributions VALUES($1,$2,$3,$4,$5,'INR',$6,$7,$8,$9,$10,$11,$12,1,$13,$13)`,
        [id, source.id, input.goalId, recipient.id, input.amountPaise, input.guestName, input.guestMessage, input.reference, status, tokenHash, requestHash, expiry, now]);
      await tx.run("INSERT INTO claim_events VALUES($1,$2,NULL,NULL,$3,0,$4,$5)",
        [randomUUID(), id, status, duplicate ? "Duplicate reference; review required. Reference is not proof." : "Guest declaration only; not verified.", now]);
      const row = await tx.get<ClaimRow>(`${selection} WHERE c.id=$1`, [id]);
      if (!row) throw new Error("Created contribution is missing.");
      return receipt(row);
    });
  }

  async status(token: unknown): Promise<ClaimReceipt> {
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) throw new AppError(404, "NOT_FOUND", "Private report not available.");
    const row = await this.db.get<ClaimRow>(`${selection} WHERE c.token_hash=$1 AND c.token_expires_at>$2`, [hash(token), new Date().toISOString()]);
    if (!row) throw new AppError(404, "NOT_FOUND", "Private report not available or link expired.");
    return receipt(row);
  }

  async dashboard(wishlistId: string, ownerId: string, filter = "all", page = 1): Promise<ClaimDashboard> {
    await new WishlistStore(this.db).getOwner(wishlistId, ownerId);
    if (!["all", "reported", "needs_review", "owner_confirmed", "rejected"].includes(filter) ||
      !Number.isSafeInteger(page) || page < 1 || page > 10000) throw new AppError(422, "VALIDATION", "Invalid report filter or page.");
    const params = filter === "all" ? [wishlistId] : [wishlistId, filter];
    const where = `c.wishlist_id=$1${filter === "all" ? "" : " AND c.status=$2"}`;
    const rows = await this.db.all<ClaimRow>(`${selection} WHERE ${where} ORDER BY c.created_at DESC,c.id LIMIT 50 OFFSET $${params.length + 1}`, [...params, (page - 1) * 50]);
    const count = await this.db.get<{ count: string }>(`SELECT COUNT(*) AS count FROM contributions c WHERE ${where}`, params);
    const sums = await this.db.get<{ reported: string; review: string; confirmed: string; rejected: string }>(`SELECT
      COALESCE(SUM(CASE WHEN status='reported' THEN amount_paise ELSE 0 END),0) AS reported,
      COALESCE(SUM(CASE WHEN status='needs_review' THEN amount_paise ELSE 0 END),0) AS review,
      COALESCE(SUM(CASE WHEN status='owner_confirmed' THEN amount_paise ELSE 0 END),0) AS confirmed,
      COALESCE(SUM(CASE WHEN status='rejected' THEN amount_paise ELSE 0 END),0) AS rejected FROM contributions WHERE wishlist_id=$1`, [wishlistId]);
    return { claims: rows.map(ownerClaim), total: integer(count?.count), page,
      totals: { reportedPaise: integer(sums?.reported), needsReviewPaise: integer(sums?.review),
        ownerConfirmedPaise: integer(sums?.confirmed), rejectedPaise: integer(sums?.rejected) } };
  }

  async resolve(wishlistId: string, id: string, ownerId: string, to: unknown, version: unknown, reason: unknown): Promise<OwnerClaim> {
    if (!Number.isSafeInteger(version) || Number(version) < 1 || typeof reason !== "string" || !reason.trim() || reason.trim().length > 300) throw new AppError(422, "VALIDATION", "A current version and a reason of 1-300 characters are required.");
    return this.db.transaction(async (tx) => {
      await new WishlistStore(tx).getOwner(wishlistId, ownerId, true);
      const row = await tx.get<ClaimRow>(`${selection} WHERE c.wishlist_id=$1 AND c.id=$2 FOR UPDATE OF c`, [wishlistId, id]);
      if (!row) throw new AppError(404, "NOT_FOUND", "Report not found.");
      if (row.version !== version) throw new AppError(409, "STALE_VERSION", "Another action changed this report. Refresh before trying again.");
      assertClaimTransition(row.status, to);
      const amount = integer(row.amount_paise);
      const delta = (to === "owner_confirmed" ? amount : 0) - (row.status === "owner_confirmed" ? amount : 0);
      const balance = await tx.get<{ net: string }>("SELECT COALESCE(SUM(confirmed_delta_paise),0) AS net FROM claim_events WHERE contribution_id=$1", [id]);
      const net = integer(balance?.net);
      if (net + delta < 0 || net + delta > amount) throw new AppError(409, "LEDGER_MISMATCH", "Report history needs review; no totals were changed.");
      const now = new Date().toISOString();
      await tx.run("UPDATE contributions SET status=$1,version=version+1,updated_at=$2 WHERE id=$3", [to, now, id]);
      await tx.run("INSERT INTO claim_events VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [randomUUID(), id, ownerId, row.status, to, delta, reason.trim(), now]);
      const updated = await tx.get<ClaimRow>(`${selection} WHERE c.id=$1`, [id]);
      if (!updated) throw new Error("Updated contribution is missing.");
      return ownerClaim(updated);
    });
  }
}
