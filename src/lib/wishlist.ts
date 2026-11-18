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
};
export type PublicWishlist = {
  slug: string;
  displayNames: string;
  story: string;
  weddingDate: string | null;
  expiresAt: string | null;
  availability: "available" | "paused" | "closed" | "expired" | "draft" | "archived";
  currency: "INR";
  paymentMode: "demo";
  recipientSnapshot: { id: string; label: string; mode: "demo" } | null;
  goals: Goal[];
};
export type OwnerWishlist = PublicWishlist & {
  id: string;
  state: WishlistState;
  visibility: Visibility;
  version: number;
};
export type NewWishlist = {
  displayNames: string;
  story: string;
  weddingDate: string | null;
  expiresAt: string | null;
  slug: string;
  visibility: Visibility;
  goals: { title: string; description: string; targetPaise: number }[];
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
    goals: data.goals.map((inputGoal, index) => {
      const goal = record(inputGoal);
      if (Object.keys(goal).some((key) => !["title", "description", "target"].includes(key))) {
        throw new AppError(422, "VALIDATION", "Unknown goal fields are not accepted.");
      }
      let targetPaise: number;
      try { targetPaise = parseINR(goal.target); }
      catch (error) {
        if (!(error instanceof AppError)) throw error;
        throw new AppError(422, error.code, error.message, { [`goals.${index}.target`]: error.message });
      }
      return {
        title: text(goal.title, `goals.${index}.title`, 100),
        description: text(goal.description ?? "", `goals.${index}.description`, 1000, false),
        targetPaise
      };
    })
  };
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
