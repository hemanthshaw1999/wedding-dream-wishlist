import { AppError } from "./errors.ts";
import { parseINR } from "./money.ts";

export type WishlistState = "draft" | "published" | "paused" | "closed" | "archived";
export type Visibility = "public" | "unlisted" | "private";
export type Goal = {
  id: string;
  title: string;
  description: string;
  targetPaise: number;
  confirmedPaise: number;
  archivedAt: string | null;
  targetHistory: { version: number; previousPaise: number; targetPaise: number; createdAt: string }[];
};
export type NewGoal = { title: string; description: string; targetPaise: number };
export type OwnerGoal = Goal & { hasReports: boolean };
export type GoalSnapshot = {
  title: string; description: string; targetPaise: number; position: number; archivedAt: string | null;
};
export type GoalHistoryPage = {
  entries: {
    goalId: string; version: number; event: string; reason: string; createdAt: string;
    before: GoalSnapshot | null; after: GoalSnapshot;
  }[];
  hasMore: boolean;
};
export type GoalCommand = { version: number; reason: string } & (
  { action: "add"; goal: NewGoal } |
  { action: "edit"; goalId: string; goal: NewGoal; acknowledged: boolean } |
  { action: "archive" | "restore"; goalId: string } |
  { action: "reorder"; goalIds: string[] }
);
export type PaymentMode = "demo" | "upi";
export type LiveRecipient = { id: string; version: number; upiId: string; label: string };
export type RecipientVersionView = LiveRecipient & { createdAt: string };
export type PublicWishlist = {
  slug: string;
  displayNames: string;
  story: string;
  weddingDate: string | null;
  expiresAt: string | null;
  availability: "available" | "paused" | "closed" | "expired" | "draft" | "archived";
  currency: "INR";
  paymentMode: PaymentMode;
  recipientSnapshot: { id: string; label: string; mode: "demo" } | null;
  liveRecipient: LiveRecipient | null;
  goals: Goal[];
};
export type OwnerWishlist = Omit<PublicWishlist, "goals"> & {
  id: string;
  state: WishlistState;
  visibility: Visibility;
  version: number;
  goals: OwnerGoal[];
};
export type NewWishlist = {
  displayNames: string;
  story: string;
  weddingDate: string | null;
  expiresAt: string | null;
  slug: string;
  visibility: Visibility;
  goals: NewGoal[];
};

function text(value: unknown, name: string, max: number, required = true): string {
  if (typeof value !== "string" || value.trim().length > max || (required && !value.trim())) {
    throw new AppError(422, "VALIDATION", `Check ${name}.`, { [name]: `Enter ${required ? "1" : "0"}-${max} characters.` });
  }
  return value.trim();
}

function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new AppError(422, "VALIDATION", "Expected an object.");
  return input as Record<string, unknown>;
}

export function validateGoal(input: unknown, prefix = ""): NewGoal {
  const goal = record(input);
  if (Object.keys(goal).some((key) => !["title", "description", "target"].includes(key))) {
    throw new AppError(422, "VALIDATION", "Unknown goal fields are not accepted.");
  }
  let targetPaise: number;
  try { targetPaise = parseINR(goal.target); }
  catch (error) {
    if (!(error instanceof AppError)) throw error;
    throw new AppError(422, error.code, error.message, { [`${prefix}target`]: error.message });
  }
  return {
    title: text(goal.title, `${prefix}title`, 100),
    description: text(goal.description ?? "", `${prefix}description`, 1000, false),
    targetPaise
  };
}

export function validateGoalCommand(input: unknown): GoalCommand {
  const data = record(input);
  const fields: Record<string, string[]> = {
    add: ["title", "description", "target"], edit: ["goalId", "title", "description", "target", "acknowledged"],
    archive: ["goalId"], restore: ["goalId"], reorder: ["goalIds"]
  };
  if (typeof data.action !== "string" || !Object.hasOwn(fields, data.action) ||
    Object.keys(data).some((key) => !["action", "version", "reason", ...fields[data.action as string]].includes(key))) {
    throw new AppError(422, "VALIDATION", "Send a supported goal action and only its documented fields.");
  }
  if (!Number.isSafeInteger(data.version) || Number(data.version) < 1) throw new AppError(422, "VALIDATION", "A valid wishlist version is required.");
  const base = { version: Number(data.version), reason: text(data.reason, "reason", 300) };
  if (data.action === "add" || data.action === "edit") {
    const goal = validateGoal({ title: data.title, description: data.description, target: data.target });
    if (data.action === "add") return { ...base, action: "add", goal };
    if (data.acknowledged !== undefined && typeof data.acknowledged !== "boolean") throw new AppError(422, "VALIDATION", "Acknowledgement must be a boolean.");
    return { ...base, action: "edit", goalId: text(data.goalId, "goalId", 100), goal, acknowledged: data.acknowledged === true };
  }
  if (data.action === "archive" || data.action === "restore") {
    return { ...base, action: data.action, goalId: text(data.goalId, "goalId", 100) };
  }
  if (!Array.isArray(data.goalIds) || data.goalIds.length < 1 || data.goalIds.length > 20) throw new AppError(422, "VALIDATION", "Send every goal ID exactly once.");
  const goalIds = data.goalIds.map((id) => text(id, "goalIds", 100));
  if (new Set(goalIds).size !== goalIds.length) throw new AppError(422, "VALIDATION", "Duplicate goal IDs are not allowed.");
  return { ...base, action: "reorder", goalIds };
}

function dateOnly(value: unknown, field: string): string | null {
  if (value === "" || value === null || value === undefined) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "1900-01-01" || value > "2200-12-31") {
    throw new AppError(422, "VALIDATION", `Check ${field}.`, { [field]: "Enter a valid calendar date (1900-2200)." });
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new AppError(422, "VALIDATION", `Check ${field}.`, { [field]: "Enter a valid calendar date." });
  }
  return value;
}

export function validateWishlist(input: unknown, now = new Date()): NewWishlist {
  const data = record(input);
  const allowed = ["displayNames", "story", "weddingDate", "expiresOn", "slug", "visibility", "goals"];
  if (Object.keys(data).some((key) => !allowed.includes(key))) {
    throw new AppError(422, "VALIDATION", "Unknown fields are not accepted.");
  }
  const slug = text(data.slug, "slug", 60);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length < 3) {
    throw new AppError(422, "VALIDATION", "Check slug.", { slug: "Use 3-60 lowercase letters, numbers and single hyphens." });
  }
  if (!["unlisted", "public", "private"].includes(String(data.visibility))) {
    throw new AppError(422, "VALIDATION", "Choose a visibility setting.");
  }
  if (!Array.isArray(data.goals) || data.goals.length < 1 || data.goals.length > 20) {
    throw new AppError(422, "VALIDATION", "Add between 1 and 20 goals.");
  }
  const expiry = dateOnly(data.expiresOn, "expiresOn");
  let expiresAt: string | null = null;
  if (expiry) {
    // The chosen day is inclusive in Asia/Kolkata, which has no daylight-saving shift.
    expiresAt = new Date(new Date(`${expiry}T00:00:00.000Z`).valueOf() + 86_400_000 - 19_800_000).toISOString();
    if (expiresAt <= now.toISOString()) throw new AppError(422, "VALIDATION", "Expiry must be in the future.");
  }
  return {
    displayNames: text(data.displayNames, "displayNames", 100),
    story: text(data.story ?? "", "story", 2000, false),
    weddingDate: dateOnly(data.weddingDate, "weddingDate"),
    expiresAt,
    slug,
    visibility: data.visibility as Visibility,
    goals: data.goals.map((goal, index) => validateGoal(goal, `goals.${index}.`))
  };
}

export type NewRecipient = { upiId: string; label: string };

// Syntax check only: a well-formed UPI ID is never proof that the couple owns or controls it.
const UPI_ID = /^[a-zA-Z0-9._-]{2,64}@[a-zA-Z][a-zA-Z0-9]{1,29}$/;

export function validateRecipient(input: unknown): NewRecipient {
  const data = record(input);
  if (Object.keys(data).some((key) => !["upiId", "label"].includes(key))) {
    throw new AppError(422, "VALIDATION", "Unknown recipient fields are not accepted.");
  }
  const upiId = text(data.upiId, "upiId", 100);
  if (!UPI_ID.test(upiId)) {
    throw new AppError(422, "VALIDATION", "Check upiId.", { upiId: "Use a UPI ID such as name@bank. Only the syntax is checked; ownership is never verified." });
  }
  return { upiId, label: text(data.label, "label", 100) };
}

export type LiveActivation = { version: number; recipientVersionId: string; confirmUpiId: string };

export function validateLiveActivation(input: unknown): LiveActivation {
  const data = record(input);
  if (Object.keys(data).some((key) => !["version", "recipientVersionId", "confirmUpiId", "acknowledged"].includes(key))) {
    throw new AppError(422, "VALIDATION", "Send only the documented live-activation fields.");
  }
  if (!Number.isSafeInteger(data.version) || Number(data.version) < 1) throw new AppError(422, "VALIDATION", "A valid wishlist version is required.");
  if (data.acknowledged !== true) {
    throw new AppError(422, "ACK_REQUIRED", "Review the recipient in your own UPI app and acknowledge the live-payment terms before enabling them.");
  }
  return { version: Number(data.version), recipientVersionId: text(data.recipientVersionId, "recipientVersionId", 100), confirmUpiId: text(data.confirmUpiId, "confirmUpiId", 100) };
}

const transitions: Record<WishlistState, readonly WishlistState[]> = {
  draft: ["published", "closed"],
  published: ["paused", "closed"],
  paused: ["published", "closed"],
  closed: ["archived"],
  archived: []
};

export function assertTransition(from: WishlistState, to: unknown): asserts to is WishlistState {
  if (!transitions[from].includes(to as WishlistState)) throw new AppError(409, "INVALID_TRANSITION", "That state change is not allowed. Refresh the wishlist.");
}

export function availability(state: WishlistState, expiresAt: string | null, now: string): PublicWishlist["availability"] {
  if (state !== "published") return state === "paused" ? "paused" : state === "closed" ? "closed" : state;
  return expiresAt && expiresAt <= now ? "expired" : "available";
}
