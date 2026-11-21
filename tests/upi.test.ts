import { describe, expect, it } from "vitest";
import { buildUpiUri } from "../src/lib/upi";

describe("UPI payment intent links", () => {
  it("builds a prefilled upi://pay link with rupee amount and encoded fields", () => {
    const uri = buildUpiUri({ upiId: "priya.kiran@okhdfc", payeeName: "Priya & Kiran", amountPaise: 200000, note: "Home deposit" });
    expect(uri.startsWith("upi://pay?")).toBe(true);
    const params = new URLSearchParams(uri.slice("upi://pay?".length));
    expect(params.get("pa")).toBe("priya.kiran@okhdfc");
    expect(params.get("pn")).toBe("Priya & Kiran");
    expect(params.get("am")).toBe("2000.00");
    expect(params.get("cu")).toBe("INR");
    expect(params.get("tn")).toBe("Home deposit");
  });
  it("keeps odd paise and truncates over-long names and notes", () => {
    const uri = buildUpiUri({ upiId: "a.b@ybl", payeeName: "N".repeat(80), amountPaise: 101, note: "x".repeat(200) });
    const params = new URLSearchParams(uri.slice(9));
    expect(params.get("am")).toBe("1.01");
    expect(params.get("pn")).toHaveLength(50);
    expect(params.get("tn")).toHaveLength(80);
  });
  it("rejects malformed UPI IDs and out-of-range amounts", () => {
    expect(() => buildUpiUri({ upiId: "not-an-id", payeeName: "X", amountPaise: 50000, note: "" })).toThrowError(/UPI ID/);
    expect(() => buildUpiUri({ upiId: "a.b@ybl", payeeName: "X", amountPaise: 99, note: "" })).toThrowError(/range/);
    expect(() => buildUpiUri({ upiId: "a.b@ybl", payeeName: "X", amountPaise: 10_000_001, note: "" })).toThrowError(/range/);
    expect(() => buildUpiUri({ upiId: "a.b@ybl", payeeName: "X", amountPaise: 100.5, note: "" })).toThrowError(/range/);
  });
});
