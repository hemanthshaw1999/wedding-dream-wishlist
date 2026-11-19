import type { PublicWishlist } from "@/lib/wishlist";
import { formatINR } from "@/lib/money";
import { en } from "@/lib/strings";
import { GuestReport } from "./guest-report";

export function WishlistView({ wishlist, preview = false }: { wishlist: PublicWishlist; preview?: boolean }) {
  const paymentsOff = wishlist.paymentMode === "upi" && !wishlist.liveRecipient;
  const weddingDate = wishlist.weddingDate
    ? new Intl.DateTimeFormat("en-IN", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${wishlist.weddingDate}T00:00:00Z`))
    : null;
  return (
    <article>
      <header className="hero">
        <p className="eyebrow">{preview ? "Owner preview - not a guest access grant" : "A little future, together"}</p>
        <span className="ornament" aria-hidden="true">*</span>
        {preview ? <><h2>Guest page preview</h2><p className="preview-names">{wishlist.displayNames}</p></> : <h1>{wishlist.displayNames}</h1>}
        {weddingDate && <p className="date">{weddingDate}</p>}
        <p className="story">{wishlist.story || "Thank you for sharing in our next chapter. Your presence is enough."}</p>
        <span className="pill">Availability: {wishlist.availability}</span>
      </header>
      <section className="notice" aria-label="Payment information">
        {paymentsOff ? <>
          <strong>Payments temporarily unavailable</strong>
          <p>This wishlist&apos;s direct-UPI payment instructions are not shown while live payments are disabled for this deployment. Do not pay based on older screenshots or messages; check back later or reach the couple directly.</p>
        </> : wishlist.paymentMode === "upi" && wishlist.liveRecipient ? <>
          <strong>Live direct-to-couple UPI</strong>
          <p>Pay {wishlist.liveRecipient.label} at UPI ID <strong>{wishlist.liveRecipient.upiId}</strong> (instruction version {wishlist.liveRecipient.version}) using your own UPI app. Verify the recipient name your app shows before paying; this app never collects, holds or verifies money.</p>
          <p>After paying, report the amount below. A report, reference, QR or screenshot is never proof of receipt: the couple confirms only after checking their own bank records, and a reversal is not a refund.</p>
        </> : <>
          <strong>{en.demo}</strong>
          <p>{en.noPayments}</p>
          <p>Chosen direction: direct-to-couple UPI, with guest reports and manual couple confirmation. This local version only simulates the workflow; no payable UPI QR, bank verification or fees.</p>
        </>}
        {wishlist.expiresAt && <p>Closes at {new Intl.DateTimeFormat("en-IN", {
          dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata"
        }).format(new Date(wishlist.expiresAt))} IST (the exact boundary is exclusive).</p>}
      </section>
      <section aria-labelledby="dreams-title">
        <div className="section-heading">
          <div><p className="eyebrow">Experiences, not expectations</p><h2 id="dreams-title">Our dreams</h2></div>
          <p>Gifting is always optional.</p>
        </div>
        <div className="goal-grid">
          {wishlist.goals.map((goal, index) => (
            <section className="goal-card" key={goal.id} aria-labelledby={`goal-${goal.id}`}>
              <div className={`goal-art art-${index % 3}`} aria-hidden="true"><span>{String(index + 1).padStart(2, "0")}</span></div>
              <div className="goal-content">
                <h3 id={`goal-${goal.id}`}>{goal.title}</h3>
                {goal.archivedAt && <p className="pill">Archived goal - history and confirmed progress retained</p>}
                <p className="story">{goal.description || "A meaningful part of our life together."}</p>
                <p className="goal-amount">{formatINR(goal.targetPaise)} <span>target</span></p>
                <label className="progress-label" htmlFor={`progress-${goal.id}`}>Confirmed progress: {formatINR(goal.confirmedPaise)}</label>
                <progress id={`progress-${goal.id}`} value={Math.min(goal.confirmedPaise, goal.targetPaise)} max={goal.targetPaise} />
                <p className="muted">{wishlist.paymentMode === "upi" ? "Owner-confirmed reports only—not bank/provider verified. Pending reports never count. Overfunding is allowed and shown in full." : "Owner-confirmed demo reports only—not bank/provider verified. Pending reports never count. Simulated overfunding is shown in full; the live funding policy remains undecided."}</p>
                {goal.targetHistory.length > 0 && <details>
                  <summary>Target changes (latest 20)</summary>
                  <ol>{goal.targetHistory.map((change) => <li key={change.version}>
                    {change.createdAt}: {formatINR(change.previousPaise)} to {formatINR(change.targetPaise)}
                  </li>)}</ol>
                </details>}
                {!preview && <GuestReport wishlist={wishlist} goal={goal} />}
              </div>
            </section>
          ))}
        </div>
      </section>
      <p className="privacy-note">{wishlist.paymentMode === "upi" ? "Guest names, messages, references and individual gift amounts are private. Public progress includes only owner-confirmed reports, never unverified declarations." : en.privacy}</p>
    </article>
  );
}
