import { AppError } from "./errors.ts";
import { parseINR } from "./money.ts";

export type ClaimStatus = "reported" | "needs_review" | "owner_confirmed" | "rejected";
export type NewClaim = {
  goalId: string; recipientSnapshotId: string; recipientVersionId: string; amountPaise: number; currency: "INR";
  guestName: string; guestMessage: string; reference: string; token: string;
};
export type ClaimReceipt = {
  id: string; status: ClaimStatus; amountPaise: number; currency: "INR";
  goalTitle: string; recipientLabel: string; tokenExpiresAt: string; mode: "demo" | "upi";
};
export type OwnerClaim = ClaimReceipt & {
  guestName: string; guestMessage: string; reference: string; duplicateReference: boolean;
  version: number; createdAt: string;
};
export type ClaimDashboard = {
  claims: OwnerClaim[]; total: number; page: number; revision: number;
  totals: { reportedPaise: number; needsReviewPaise: number; ownerConfirmedPaise: number; rejectedPaise: number };
};

function bounded(value: unknown, limit: number, label: string): string {
  if (value === undefined) return "";
  if (typeof value !== "string" || value.trim().length > limit) throw new AppError(422, "VALIDATION", `Check ${label} (maximum ${limit} characters).`);
  return value.trim();
}

export function validateClaim(input: unknown): NewClaim {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new AppError(422, "VALIDATION", "Expected a report object.");
  const data = input as Record<string, unknown>;
  if (Object.keys(data).some((key) => !["goalId", "recipientSnapshotId", "recipientVersionId", "amount", "currency", "guestName", "guestMessage", "reference", "token"].includes(key))) {
    throw new AppError(422, "VALIDATION", "Unknown report fields are not accepted.");
  }
  if (data.currency !== "INR") throw new AppError(422, "CURRENCY_MISMATCH", "Only INR is supported.");
  if (typeof data.token !== "string" || !/^[a-f0-9]{64}$/.test(data.token)) throw new AppError(422, "INVALID_TOKEN", "A private 256-bit report key is required.");
  const amountPaise = parseINR(data.amount);
  if (amountPaise < 100 || amountPaise > 10_000_000) throw new AppError(422, "INVALID_AMOUNT", "Report between INR 1 and INR 1,00,000.");
  const goalId = bounded(data.goalId, 64, "goal");
  const recipientSnapshotId = bounded(data.recipientSnapshotId, 64, "recipient");
  const recipientVersionId = bounded(data.recipientVersionId, 64, "recipient version");
  if (!goalId || (!recipientSnapshotId) === (!recipientVersionId)) {
    throw new AppError(422, "VALIDATION", "A goal and exactly one recipient instruction reference are required.");
  }
  return {
    goalId, recipientSnapshotId, recipientVersionId, amountPaise, currency: "INR", token: data.token,
    guestName: bounded(data.guestName, 100, "name"),
    guestMessage: bounded(data.guestMessage, 500, "message"),
    reference: bounded(data.reference, 64, "reference").toUpperCase()
  };
}

const transitions: Record<ClaimStatus, readonly ClaimStatus[]> = {
  reported: ["needs_review", "owner_confirmed", "rejected"],
  needs_review: ["owner_confirmed", "rejected"],
  owner_confirmed: ["needs_review"],
  rejected: ["needs_review"]
};
export function assertClaimTransition(from: ClaimStatus, to: unknown): asserts to is ClaimStatus {
  if (!transitions[from].includes(to as ClaimStatus)) throw new AppError(409, "INVALID_TRANSITION", "That report change is not allowed. Refresh before trying again.");
}

export function csvCell(value: string): string {
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
