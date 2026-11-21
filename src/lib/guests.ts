import { AppError } from "./errors.ts";

export type GuestRsvp = "pending" | "attending" | "not_attending";

export type GuestEntry = {
  id: string;
  name: string;
  rsvp: GuestRsvp;
  expectedArrival: string | null;
  rsvpUpdatedAt: string | null;
  createdAt: string;
};

export type GuestSummary = { invited: number; attending: number; notAttending: number; awaiting: number };

export type OwnerGuestList = { summary: GuestSummary; guests: GuestEntry[] };

// What the guest's private link shows. No other guests, no amounts, no owner identifiers.
export type RsvpView = {
  displayNames: string;
  weddingDate: string | null;
  name: string;
  rsvp: GuestRsvp;
  expectedArrival: string | null;
  open: boolean;
};

export function validateGuestName(input: unknown): { name: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new AppError(422, "VALIDATION", "Expected a guest object.");
  const data = input as Record<string, unknown>;
  if (Object.keys(data).some((key) => key !== "name")) throw new AppError(422, "VALIDATION", "Send only the guest name.");
  if (typeof data.name !== "string" || !data.name.trim() || data.name.trim().length > 100) {
    throw new AppError(422, "VALIDATION", "Check the guest name.", { name: "Enter 1-100 characters." });
  }
  return { name: data.name.trim() };
}

export type BulkGuestResult = {
  added: { name: string; invitePath: string }[];
  duplicates: string[];
};

export function validateGuestNames(input: unknown): { names: string[] } {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new AppError(422, "VALIDATION", "Expected a guest list object.");
  const data = input as Record<string, unknown>;
  if (Object.keys(data).some((key) => key !== "names")) throw new AppError(422, "VALIDATION", "Send only the guest names.");
  if (!Array.isArray(data.names) || data.names.length < 1 || data.names.length > 200) {
    throw new AppError(422, "VALIDATION", "Add between 1 and 200 guests at a time.");
  }
  const names = data.names.map((value) => {
    if (typeof value !== "string" || !value.trim() || value.trim().length > 100) {
      throw new AppError(422, "VALIDATION", "Check the guest names.", { names: "Each name needs 1-100 characters. Remove empty lines." });
    }
    return value.trim();
  });
  const seen = new Set<string>();
  const unique = names.filter((name) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { names: unique };
}

export function validateRsvpUpdate(input: unknown): { rsvp: GuestRsvp; expectedArrival: string | null } {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new AppError(422, "VALIDATION", "Expected an RSVP object.");
  const data = input as Record<string, unknown>;
  if (Object.keys(data).some((key) => !["rsvp", "expectedArrival"].includes(key))) {
    throw new AppError(422, "VALIDATION", "Send only rsvp and expectedArrival.");
  }
  if (!["attending", "not_attending"].includes(String(data.rsvp))) {
    throw new AppError(422, "VALIDATION", "Choose whether you will attend.", { rsvp: "Answer Yes or No." });
  }
  let expectedArrival: string | null = null;
  if (data.expectedArrival !== undefined && data.expectedArrival !== null && data.expectedArrival !== "") {
    if (typeof data.expectedArrival !== "string" || !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(data.expectedArrival)) {
      throw new AppError(422, "VALIDATION", "Check the arrival time.", { expectedArrival: "Enter a valid time of day." });
    }
    expectedArrival = data.expectedArrival;
  }
  return { rsvp: data.rsvp as GuestRsvp, expectedArrival };
}

export type HostRsvpUpdate = { rsvp: GuestRsvp; expectedArrival: string | null; previousUpdatedAt: string | null; reason: string };
export function validateHostRsvpUpdate(input: unknown): HostRsvpUpdate {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new AppError(422, "VALIDATION", "Expected an RSVP update.");
  const data = input as Record<string, unknown>;
  if (Object.keys(data).some((key) => !["rsvp", "expectedArrival", "previousUpdatedAt", "reason"].includes(key))) throw new AppError(422, "VALIDATION", "Unexpected RSVP fields.");
  const answer = validateRsvpUpdate({ rsvp: data.rsvp, expectedArrival: data.expectedArrival });
  if (data.previousUpdatedAt !== null && (typeof data.previousUpdatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(data.previousUpdatedAt) || !Number.isFinite(Date.parse(data.previousUpdatedAt)))) throw new AppError(422, "VALIDATION", "Refresh the guest list before saving.");
  if (typeof data.reason !== "string" || data.reason.trim().length < 3 || data.reason.trim().length > 200) throw new AppError(422, "VALIDATION", "Add a short source note, such as Phone call with guest.");
  return { ...answer, previousUpdatedAt: data.previousUpdatedAt as string | null, reason: data.reason.trim() };
}

const arrivalFormatter = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "UTC" });

export function formatArrival(value: string | null): string | null {
  if (!value) return null;
  return arrivalFormatter.format(new Date(`2000-01-01T${value}:00Z`));
}
