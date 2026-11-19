import { randomUUID } from "node:crypto";
import type { Database } from "./database.ts";
import { liveUpiApproved } from "./config.ts";
import { AppError } from "../lib/errors.ts";
import { availability, assertTransition, validateGoalCommand, validateLiveActivation, validateRecipient } from "../lib/wishlist.ts";
import type { GoalHistoryPage, GoalSnapshot, NewWishlist, OwnerWishlist, PaymentMode, PublicWishlist, RecipientVersionView, Visibility, WishlistState } from "../lib/wishlist.ts";

type WishlistRow = {
  id: string; slug: string; display_names: string; story: string;
  wedding_date: string | null; expires_at: string | null;
  visibility: Visibility; state: WishlistState; version: number;
  payment_mode: PaymentMode; live_recipient_id: string | null;
};
type GoalRow = { id: string; title: string; description: string; target_paise: string; confirmed_paise: string; archived_at: string | null };
type HistorySnapshot = { title: string; description: string; target_paise: number; position: number; archived_at: string | null };
function snapshot(value: HistorySnapshot): GoalSnapshot {
  return { title: value.title, description: value.description, targetPaise: integer(value.target_paise),
    position: value.position, archivedAt: value.archived_at };
}
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
      w.expires_at,w.visibility,w.state,w.version,w.payment_mode,w.live_recipient_id FROM wishlists w
      JOIN memberships m ON m.wishlist_id=w.id WHERE w.id=$1 AND m.user_id=$2 AND m.role='owner'
      ${lock ? "FOR UPDATE OF w" : ""}`, [id, ownerId]);
    if (!row) throw new AppError(404, "NOT_FOUND", "Wishlist not found.");
    return row;
  }

  private async project(row: WishlistRow, guestSafe = false): Promise<PublicWishlist> {
    const goals = await this.db.all<GoalRow>(`SELECT g.id,g.title,g.description,g.target_paise,g.archived_at,
      COALESCE(SUM(e.confirmed_delta_paise),0) + (SELECT COALESCE(SUM(k.amount_paise),0) FROM cash_gifts k
        WHERE k.goal_id=g.id AND k.voided_at IS NULL) AS confirmed_paise FROM goals g
      LEFT JOIN contributions c ON c.goal_id=g.id LEFT JOIN claim_events e ON e.contribution_id=c.id
      WHERE g.wishlist_id=$1 GROUP BY g.id ORDER BY g.position`, [row.id]);
    const recipient = await this.db.get<{ id: string; label: string }>("SELECT id,label FROM recipient_snapshots WHERE wishlist_id=$1", [row.id]);
    const changes = await this.db.all<{ goal_id: string; version: number; previous: string; target: string; created_at: string }>(`
      SELECT g.id AS goal_id,h.version,h.before_snapshot->>'target_paise' AS previous,
        h.after_snapshot->>'target_paise' AS target,h.created_at FROM goals g
      CROSS JOIN LATERAL(SELECT version,before_snapshot,after_snapshot,created_at FROM goal_history
        WHERE goal_id=g.id AND before_snapshot IS NOT NULL AND
          before_snapshot->'target_paise' IS DISTINCT FROM after_snapshot->'target_paise'
        ORDER BY version DESC LIMIT 20) h WHERE g.wishlist_id=$1 ORDER BY g.position,h.version`, [row.id]);
    const live = row.payment_mode === "upi"
      ? await this.db.get<{ id: string; version: number; upi_id: string; label: string }>(
        "SELECT id,version,upi_id,label FROM recipient_versions WHERE id=$1 AND wishlist_id=$2", [row.live_recipient_id, row.id])
      : undefined;
    if (row.payment_mode === "upi" && !live) throw new Error("Live recipient binding is missing.");
    // Deployment-off gate: guests never see payable instructions for existing live rows
    // while the operator has not recorded owner approval for live direct UPI.
    // Only guest opt-ins the couple has confirmed. Cash gifts and unchecked reports never appear here.
    const supporters = await this.db.all<{ name: string; amount: string; goal_title: string }>(`SELECT trim(c.guest_name) AS name,
      c.amount_paise::text AS amount,g.title AS goal_title FROM contributions c JOIN goals g ON g.id=c.goal_id
      WHERE c.wishlist_id=$1 AND c.status='owner_confirmed' AND c.public_display ORDER BY c.amount_paise DESC,c.created_at LIMIT 25`, [row.id]);
    const showLive = live && (!guestSafe || liveUpiApproved());
    return {
      slug: row.slug, displayNames: row.display_names, story: row.story,
      weddingDate: row.wedding_date, expiresAt: row.expires_at,
      availability: availability(row.state, row.expires_at, new Date().toISOString()),
      currency: "INR", paymentMode: row.payment_mode,
      recipientSnapshot: recipient ? { id: recipient.id, label: recipient.label, mode: "demo" } : null,
      liveRecipient: showLive ? { id: live.id, version: live.version, upiId: live.upi_id, label: live.label } : null,
      supporters: supporters.map((item) => ({ name: item.name, amountPaise: integer(item.amount), goalTitle: item.goal_title })),
      goals: goals.map((goal) => ({
        id: goal.id, title: goal.title, description: goal.description,
        targetPaise: integer(goal.target_paise), confirmedPaise: integer(goal.confirmed_paise), archivedAt: goal.archived_at,
        targetHistory: changes.filter((change) => change.goal_id === goal.id).map((change) => ({
          version: change.version, previousPaise: integer(change.previous), targetPaise: integer(change.target), createdAt: change.created_at
        }))
      }))
    };
  }

  async getOwner(id: string, ownerId: string, lock = false): Promise<OwnerWishlist> {
    return this.db.readSnapshot(async (tx) => {
      const scoped = new WishlistStore(tx);
      const row = await scoped.row(id, ownerId, lock);
      const value = await scoped.project(row);
      const reported = await tx.all<{ goal_id: string }>("SELECT DISTINCT goal_id FROM contributions WHERE wishlist_id=$1", [id]);
      const reportedIds = new Set(reported.map((goal) => goal.goal_id));
      return { ...value, id: row.id, state: row.state, visibility: row.visibility, version: row.version,
        goals: value.goals.map((goal) => ({ ...goal, hasReports: reportedIds.has(goal.id) })) };
    });
  }

  async listOwner(ownerId: string): Promise<{ id: string; displayNames: string; slug: string; state: WishlistState }[]> {
    const rows = await this.db.all<Pick<WishlistRow, "id" | "display_names" | "slug" | "state">>(`SELECT w.id,w.display_names,w.slug,w.state FROM wishlists w
      JOIN memberships m ON m.wishlist_id=w.id WHERE m.user_id=$1 ORDER BY w.created_at DESC,w.id`, [ownerId]);
    return rows.map((row) => ({ id: row.id, displayNames: row.display_names, slug: row.slug, state: row.state }));
  }

  async getPublic(slug: string, lock = false): Promise<PublicWishlist> {
    return this.db.readSnapshot(async (tx) => {
      const row = await tx.get<WishlistRow>(`SELECT id,slug,display_names,story,wedding_date,expires_at,
        visibility,state,version,payment_mode,live_recipient_id FROM wishlists WHERE slug=$1 AND state IN ('published','paused','closed')
        AND visibility IN ('public','unlisted') ${lock ? "FOR UPDATE" : ""}`, [slug]);
      if (!row) throw new AppError(404, "NOT_FOUND", "Wishlist not available.");
      return new WishlistStore(tx).project(row, true);
    });
  }

  async create(ownerId: string, input: NewWishlist): Promise<OwnerWishlist> {
    const id = randomUUID();
    const now = new Date().toISOString();
    try {
      return await this.db.transaction(async (tx) => {
        await tx.run(`INSERT INTO wishlists(id,slug,display_names,story,wedding_date,expires_at,
          visibility,state,currency,payment_mode,funding_policy,created_at,updated_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,'draft','INR','demo','undecided',$8,$8)`,
        [id, input.slug, input.displayNames, input.story, input.weddingDate, input.expiresAt, input.visibility, now]);
        await tx.run("INSERT INTO memberships VALUES($1,$2,'owner')", [id, ownerId]);
        await tx.run("SELECT set_config('app.actor_id',$1,true),set_config('app.change_reason','Initial goal creation',true)", [ownerId]);
        await tx.run("INSERT INTO recipient_snapshots VALUES($1,$2,$3,'demo',$4)", [randomUUID(), id, input.displayNames, now]);
        for (const [position, goal] of input.goals.entries()) {
          await tx.run("INSERT INTO goals(id,wishlist_id,title,description,target_paise,position) VALUES($1,$2,$3,$4,$5,$6)", [randomUUID(), id, goal.title, goal.description, goal.targetPaise, position]);
        }
        await tx.run("INSERT INTO audit_entries VALUES($1,$2,$3,'created',NULL,'draft',$4)", [randomUUID(), id, ownerId, now]);
        return new WishlistStore(tx).getOwner(id, ownerId);
      });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "23505" &&
        "constraint" in error && error.constraint === "wishlists_slug_key") {
        throw new AppError(409, "SLUG_TAKEN", "This share slug is already in use.", { slug: "Choose another slug." });
      }
      throw error;
    }
  }

  async recipientVersions(id: string, ownerId: string): Promise<RecipientVersionView[]> {
    await this.row(id, ownerId);
    const rows = await this.db.all<{ id: string; version: number; upi_id: string; label: string; created_at: string }>(
      "SELECT id,version,upi_id,label,created_at FROM recipient_versions WHERE wishlist_id=$1 ORDER BY version DESC", [id]);
    return rows.map((row) => ({ id: row.id, version: row.version, upiId: row.upi_id, label: row.label, createdAt: row.created_at }));
  }

  async addRecipientVersion(id: string, ownerId: string, input: unknown): Promise<RecipientVersionView> {
    const command = validateRecipient(input);
    return this.db.transaction(async (tx) => {
      const row = await new WishlistStore(tx).row(id, ownerId, true);
      const now = new Date().toISOString();
      if (["closed", "archived"].includes(row.state) || (row.expires_at && row.expires_at <= now)) {
        throw new AppError(409, "UNAVAILABLE", "Closed or expired wishlists cannot change payment setup.");
      }
      const next = await tx.get<{ version: number }>("SELECT COALESCE(MAX(version),0)+1 AS version FROM recipient_versions WHERE wishlist_id=$1", [id]);
      if (!next || !Number.isSafeInteger(Number(next.version))) throw new Error("Recipient version sequence is missing.");
      const versionId = randomUUID();
      await tx.run("INSERT INTO recipient_versions VALUES($1,$2,$3,$4,$5,$6,$7)", [versionId, id, Number(next.version), command.upiId, command.label, ownerId, now]);
      await tx.run("INSERT INTO audit_entries VALUES($1,$2,$3,'recipient_version_added',$4,$4,$5)", [randomUUID(), id, ownerId, row.state, now]);
      return { id: versionId, version: Number(next.version), upiId: command.upiId, label: command.label, createdAt: now };
    });
  }

  async activateLive(id: string, ownerId: string, input: unknown): Promise<OwnerWishlist> {
    const command = validateLiveActivation(input);
    if (!liveUpiApproved()) {
      throw new AppError(503, "LIVE_PAYMENTS_DISABLED", "Live payment instructions are disabled for this deployment. The operator has not recorded owner approval for live direct UPI.");
    }
    return this.db.transaction(async (tx) => {
      const scoped = new WishlistStore(tx);
      const row = await scoped.row(id, ownerId, true);
      if (row.version !== command.version) throw new AppError(409, "STALE_VERSION", "This wishlist changed in another tab. Refresh and review before trying again.");
      const now = new Date().toISOString();
      if (["closed", "archived"].includes(row.state) || (row.expires_at && row.expires_at <= now)) {
        throw new AppError(409, "UNAVAILABLE", "Closed or expired wishlists cannot change payment setup.");
      }
      const target = await tx.get<{ id: string; upi_id: string }>("SELECT id,upi_id FROM recipient_versions WHERE id=$1 AND wishlist_id=$2", [command.recipientVersionId, id]);
      if (!target) throw new AppError(404, "NOT_FOUND", "Recipient version not found. Refresh before trying again.");
      if (target.upi_id !== command.confirmUpiId) {
        throw new AppError(422, "CONFIRM_MISMATCH", "Re-enter the exact UPI ID of the chosen version to confirm you reviewed it.", { confirmUpiId: "Must exactly match the chosen recipient UPI ID." });
      }
      if (row.payment_mode === "upi") {
        if (row.live_recipient_id === target.id) throw new AppError(409, "NO_CHANGE", "This recipient version is already active.");
      } else {
        const existing = await tx.get("SELECT id FROM contributions WHERE wishlist_id=$1 LIMIT 1", [id]);
        if (existing) throw new AppError(409, "HISTORY_LOCKED", "A wishlist with existing demo reports can never become a live-payment wishlist. Create a fresh wishlist for live payments.");
      }
      await tx.run("UPDATE wishlists SET payment_mode='upi',funding_policy='allow_overfunding',live_recipient_id=$1,version=version+1,updated_at=$2 WHERE id=$3", [target.id, now, id]);
      await tx.run("INSERT INTO audit_entries VALUES($1,$2,$3,$4,$5,$5,$6)", [randomUUID(), id, ownerId,
        row.payment_mode === "upi" ? "live_recipient_changed" : "live_activated", row.state, now]);
      return scoped.getOwner(id, ownerId);
    });
  }

  async goalHistory(id: string, ownerId: string): Promise<GoalHistoryPage> {
    await this.row(id, ownerId);
    const rows = await this.db.all<{
      goal_id: string; version: number; event: string; reason: string; created_at: string;
      before_snapshot: HistorySnapshot | null; after_snapshot: HistorySnapshot;
    }>(`SELECT goal_id,version,event,reason,created_at,before_snapshot,after_snapshot FROM goal_history
      WHERE wishlist_id=$1 ORDER BY created_at DESC,goal_id,version DESC LIMIT 101`, [id]);
    return { entries: rows.slice(0, 100).map((row) => ({
      goalId: row.goal_id, version: row.version, event: row.event, reason: row.reason, createdAt: row.created_at,
      before: row.before_snapshot ? snapshot(row.before_snapshot) : null, after: snapshot(row.after_snapshot)
    })), hasMore: rows.length > 100 };
  }

  async changeGoals(id: string, ownerId: string, input: unknown): Promise<OwnerWishlist> {
    const command = validateGoalCommand(input);
    return this.db.transaction(async (tx) => {
      const scoped = new WishlistStore(tx);
      const current = await scoped.getOwner(id, ownerId, true);
      if (current.version !== command.version) throw new AppError(409, "STALE_VERSION", "This wishlist changed in another tab. Refresh and review before trying again.");
      const now = new Date().toISOString();
      if (["closed", "archived"].includes(current.state) || (current.expiresAt && current.expiresAt <= now)) {
        throw new AppError(409, "UNAVAILABLE", "Closed or expired wishlists cannot change goals.");
      }
      await tx.run(`SELECT set_config('app.actor_id',$1,true),set_config('app.change_reason',$2,true),
        set_config('app.target_change_acknowledged',$3,true)`,
      [ownerId, command.reason, command.action === "edit" && command.acknowledged ? "yes" : "no"]);
      if (command.action === "add") {
        if (current.goals.length >= 20) throw new AppError(422, "GOAL_LIMIT", "A wishlist can retain at most 20 goals, including archived goals.");
        const next = await tx.get<{ position: number }>("SELECT COALESCE(MAX(position),-1)+1 AS position FROM goals WHERE wishlist_id=$1", [id]);
        if (!next) throw new Error("Goal position is missing.");
        await tx.run("INSERT INTO goals(id,wishlist_id,title,description,target_paise,position) VALUES($1,$2,$3,$4,$5,$6)",
          [randomUUID(), id, command.goal.title, command.goal.description, command.goal.targetPaise, next.position]);
      } else if (command.action === "reorder") {
        const ids = current.goals.map((goal) => goal.id);
        if (command.goalIds.length !== ids.length || command.goalIds.some((goalId) => !ids.includes(goalId))) {
          throw new AppError(422, "GOAL_MISMATCH", "Reordering must include every goal of this wishlist exactly once, including archived goals.");
        }
        if (ids.every((goalId, index) => goalId === command.goalIds[index])) throw new AppError(409, "NO_CHANGE", "The goal order did not change.");
        await tx.run("SET CONSTRAINTS goals_wishlist_id_position_key DEFERRED");
        await tx.run(`UPDATE goals g SET position=(ordered.position-1)::integer
          FROM unnest($1::text[]) WITH ORDINALITY AS ordered(id,position)
          WHERE g.id=ordered.id AND g.wishlist_id=$2 AND g.position<>ordered.position-1`, [command.goalIds, id]);
      } else {
        const goal = current.goals.find((goal) => goal.id === command.goalId);
        if (!goal) throw new AppError(404, "NOT_FOUND", "Goal not found.");
        if (command.action === "edit") {
          if (goal.archivedAt) throw new AppError(409, "ARCHIVED", "Restore an archived goal before editing it.");
          if (goal.hasReports && (command.goal.title !== goal.title || command.goal.description !== goal.description)) {
            throw new AppError(409, "PURPOSE_LOCKED", "A goal's title and description cannot change after any guest report.");
          }
          const targetChanged = command.goal.targetPaise !== goal.targetPaise;
          if (!targetChanged && command.goal.title === goal.title && command.goal.description === goal.description) throw new AppError(409, "NO_CHANGE", "No goal details changed.");
          if (targetChanged && command.goal.targetPaise < goal.confirmedPaise) throw new AppError(422, "TARGET_BELOW_CONFIRMED", "The new target cannot be below current confirmed progress.");
          if (targetChanged && goal.hasReports && !command.acknowledged) throw new AppError(422, "ACK_REQUIRED", "Acknowledge the visible target change after guest reports.");
          await tx.run("UPDATE goals SET title=$1,description=$2,target_paise=$3 WHERE id=$4 AND wishlist_id=$5",
            [command.goal.title, command.goal.description, command.goal.targetPaise, goal.id, id]);
        } else {
          if ((command.action === "archive") === Boolean(goal.archivedAt)) throw new AppError(409, "NO_CHANGE", "The goal already has that archive state.");
          await tx.run("UPDATE goals SET archived_at=$1 WHERE id=$2 AND wishlist_id=$3", [command.action === "archive" ? now : null, goal.id, id]);
        }
      }
      await tx.run("UPDATE wishlists SET version=version+1,updated_at=$1 WHERE id=$2", [now, id]);
      await tx.run("INSERT INTO audit_entries VALUES($1,$2,$3,'goals_changed',$4,$4,$5)", [randomUUID(), id, ownerId, current.state, now]);
      return scoped.getOwner(id, ownerId);
    });
  }

  async transition(id: string, ownerId: string, to: unknown, expectedVersion: unknown): Promise<OwnerWishlist> {
    if (!Number.isSafeInteger(expectedVersion) || Number(expectedVersion) < 1) throw new AppError(422, "VALIDATION", "A valid version is required.");
    return this.db.transaction(async (tx) => {
      const row = await new WishlistStore(tx).row(id, ownerId, true);
      if (row.version !== expectedVersion) throw new AppError(409, "STALE_VERSION", "This wishlist changed in another tab. Refresh before trying again.");
      assertTransition(row.state, to);
      if (to === "published" && row.expires_at && row.expires_at <= new Date().toISOString()) throw new AppError(409, "EXPIRED", "An expired wishlist cannot be published.");
      const now = new Date().toISOString();
      await tx.run("UPDATE wishlists SET state=$1,version=version+1,updated_at=$2 WHERE id=$3", [to, now, id]);
      await tx.run("INSERT INTO audit_entries VALUES($1,$2,$3,'state_changed',$4,$5,$6)", [randomUUID(), id, ownerId, row.state, to, now]);
      return new WishlistStore(tx).getOwner(id, ownerId);
    });
  }
}
