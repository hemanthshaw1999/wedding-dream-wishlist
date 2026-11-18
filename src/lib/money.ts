import { AppError } from "./errors.ts";

export const MAX_TARGET_PAISE = 1_000_000_000;

export function parseINR(input: unknown): number {
  if (typeof input !== "string" || !/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(input)) {
    throw new AppError(422, "INVALID_AMOUNT", "Use a plain INR amount with at most two decimal places, without commas.");
  }
  const [whole, fraction = ""] = input.split(".");
  const paise = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(paise) || paise < 1 || paise > MAX_TARGET_PAISE) {
    throw new AppError(422, "INVALID_AMOUNT", "Target must be between INR 0.01 and INR 1,00,00,000.");
  }
  return paise;
}

export function formatINR(paise: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency", currency: "INR",
    minimumFractionDigits: paise % 100 ? 2 : 0,
    maximumFractionDigits: 2
  }).format(paise / 100);
}
