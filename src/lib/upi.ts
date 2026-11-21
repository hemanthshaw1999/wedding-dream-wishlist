import { AppError } from "./errors.ts";

// Standard NPCI UPI intent. This is only a prefilled payment REQUEST the guest's own UPI app
// shows for review; the app never learns whether the guest actually paid.
const UPI_ID = /^[a-zA-Z0-9._-]{2,64}@[a-zA-Z][a-zA-Z0-9]{1,29}$/;

export function buildUpiUri(input: { upiId: string; payeeName: string; amountPaise: number; note: string }): string {
  if (!UPI_ID.test(input.upiId)) throw new AppError(422, "VALIDATION", "The recipient UPI ID is not well formed.");
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise < 100 || input.amountPaise > 10_000_000) {
    throw new AppError(422, "VALIDATION", "Amount out of range.");
  }
  const params = new URLSearchParams({
    pa: input.upiId,
    pn: input.payeeName.slice(0, 50),
    am: (input.amountPaise / 100).toFixed(2),
    cu: "INR",
    tn: input.note.slice(0, 80)
  });
  return `upi://pay?${params.toString()}`;
}
