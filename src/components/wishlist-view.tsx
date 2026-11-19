import type { PublicWishlist } from "@/lib/wishlist";
import { formatINR } from "@/lib/money";
import { en } from "@/lib/strings";
import { GuestReport } from "./guest-report";

export function WishlistView({ wishlist, preview = false }: { wishlist: PublicWishlist; preview?: boolean }) {
  const weddingDate = wishlist.weddingDate
    ? new Intl.DateTimeFormat("en-IN", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${wishlist.weddingDate}T00:00:00Z`))
    : null;
  return (
    <article>
      <header className="hero">
        <p className="eyebrow">{preview ? "Owner preview - not a guest access grant" : "A little future, together"}</p>
        <span className="ornament" aria-hidden="true">*</span>
        <h1>{wishlist.displayNames}</h1>
        {weddingDate && <p className="date">{weddingDate}</p>}
        <p className="story">{wishlist.story || "Thank you for sharing in our next chapter. Your presence is enough."}</p>
        <span className="pill">Availability: {wishlist.availability}</span>
      </header>
      <section className="notice" aria-label="Payment information">
        <strong>{en.demo}</strong>
        <p>{en.noPayments}</p>
        <p>Chosen direction: direct-to-couple UPI, with guest reports and manual couple confirmation. This local version only simulates the workflow; no payable UPI QR, bank verification or fees.</p>
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
                <p className="muted">Owner-confirmed demo reports only—not bank/provider verified. Pending reports never count. Simulated overfunding is shown in full; the live funding policy remains undecided.</p>
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
      <p className="privacy-note">{en.privacy}</p>
    </article>
  );
}
