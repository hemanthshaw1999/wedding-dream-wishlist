import { describe, expect, it } from "vitest";
import { formatINR, parseINR } from "../src/lib/money";
import { validateWishlist, availability, assertTransition } from "../src/lib/wishlist";

describe("integer-paise target validation", () => {
  it.each([
    ["0.01", 1], ["500", 50_000], ["2000.5", 200_050], ["300000", 30_000_000], ["10000000", 1_000_000_000]
  ])("converts %s exactly", (input, paise) => expect(parseINR(input)).toBe(paise));
  it.each(["", "0", "-1", "1.001", "1e3", "Infinity", "NaN", "1,000", " 500", "+500", ".5", "01", "10000000.01", "999999999999999999999", "5\n", "0x10", 500, null])(
    "rejects malformed, zero, negative, excess-precision or over-limit amount %j", (input) => expect(() => parseINR(input)).toThrow()
  );
  it("uses Indian grouping and preserves paise", () => {
    expect(formatINR(30_000_000)).toContain("3,00,000");
    expect(formatINR(101)).toContain("1.01");
  });
});

export const input = {
  displayNames: "तारा & Arjun 💛",
  story: "<script>alert('not HTML')</script>",
  weddingDate: "2027-02-14",
  slug: "fictional-couple",
  visibility: "unlisted",
  goals: [{ title: "Honeymoon", description: "A story", target: "300000" }]
};

describe("wishlist boundaries", () => {
  it("keeps Unicode and user text as text", () => expect(validateWishlist(input).displayNames).toContain("💛"));
  it.each(["2027-02-29", "not-a-date", "2027-13-01"])("rejects invalid date %s", (date) => {
    expect(() => validateWishlist({ ...input, weddingDate: date })).toThrow();
  });
  it("rejects currency, payment-mode and owner overrides", () => {
    for (const extra of [{ currency: "USD" }, { paymentMode: "provider" }, { ownerId: "another" }]) {
      expect(() => validateWishlist({ ...input, ...extra })).toThrow("Unknown fields");
    }
  });
  it("rejects empty, excessive goals and invalid slugs", () => {
    for (const value of [{ goals: [] }, { goals: Array(21).fill(input.goals[0]) }, { slug: "../owner" }]) {
      expect(() => validateWishlist({ ...input, ...value })).toThrow();
    }
  });
  it("expires at the exclusive next midnight IST boundary", () => {
    const value = validateWishlist({ ...input, expiresOn: "2027-02-14" });
    expect(value.expiresAt).toBe("2027-02-14T18:30:00.000Z");
    expect(availability("published", value.expiresAt, "2027-02-14T18:29:59.999Z")).toBe("available");
    expect(availability("published", value.expiresAt, "2027-02-14T18:30:00.000Z")).toBe("expired");
  });
  it("rejects past expiry", () => expect(() => validateWishlist({ ...input, expiresOn: "2000-01-01" })).toThrow());
  it("rejects reopening and direct archival of active wishlists", () => {
    expect(() => assertTransition("closed", "published")).toThrow();
    expect(() => assertTransition("published", "archived")).toThrow();
    expect(() => assertTransition("draft", "published")).not.toThrow();
  });
});
