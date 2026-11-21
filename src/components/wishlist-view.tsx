import type { PublicWishlist } from "@/lib/wishlist";
import { formatINR } from "@/lib/money";
import { GuestReport } from "./guest-report";
import { WeddingMark, WeddingFlourish, WeddingGarland } from "./wedding-mark";
import { applicationConfig } from "@/server/config";

export function WishlistView({ wishlist, preview = false }: { wishlist: PublicWishlist; preview?: boolean }) {
  const paymentsOff = wishlist.paymentMode === "upi" && !wishlist.liveRecipient;
  const production = applicationConfig().mode === "production";
  const weddingDate = wishlist.weddingDate
    ? new Intl.DateTimeFormat("en-IN", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${wishlist.weddingDate}T00:00:00Z`))
    : null;
  return (
    <article>
      <header className="hero invitation-header">
        <p className="eyebrow">{preview ? "Preview of your guest page" : "Together with the people we love"}</p>
        <WeddingFlourish /><WeddingGarland /><WeddingMark />
        {preview ? <><h2>Guest page preview</h2><p className="preview-names">{wishlist.displayNames}</p></> : <h1>{wishlist.displayNames}</h1>}
        {weddingDate && <p className="date">{weddingDate}</p>}
        <p className="story">{wishlist.story || "Thank you for sharing in our next chapter. Your presence is enough."}</p>
        {wishlist.availability !== "available" && <span className="pill">This wishlist is {wishlist.availability}</span>}
      </header>
      {(paymentsOff || (production && wishlist.paymentMode !== "upi") || wishlist.expiresAt) && <section className="notice" aria-label="Gifting status">
        {(paymentsOff || (production && wishlist.paymentMode !== "upi")) && <p><strong>Gifting isn&apos;t open for this wishlist yet.</strong> Please check back later, and don&apos;t pay from older screenshots or messages.</p>}
        {wishlist.expiresAt && <p>Gifting closes {new Intl.DateTimeFormat("en-IN", {
          dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata"
        }).format(new Date(wishlist.expiresAt))} IST.</p>}
      </section>}
      <section aria-labelledby="dreams-title">
        <div className="section-heading">
          <div><p className="eyebrow">For our happily ever after</p><h2 id="dreams-title">Our dreams</h2></div>
          <p>Your presence is our greatest gift. If you wish, help a little dream come true.{wishlist.paymentMode === "upi" && wishlist.liveRecipient ? ` You pay ${wishlist.liveRecipient.label} directly in your own UPI app, then let them know here.` : ""}</p>
        </div>
        <div className="goal-grid">
          {wishlist.goals.map((goal, index) => (
            <section className="goal-card" key={goal.id} aria-labelledby={`goal-${goal.id}`}>
              <div className={`goal-art art-${index % 3}`} aria-hidden="true"><span>{String(index + 1).padStart(2, "0")}</span></div>
              <div className="goal-content">
                <h3 id={`goal-${goal.id}`}>{goal.title}</h3>
                {!goal.archivedAt && goal.targetPaise > 0 && goal.confirmedPaise >= goal.targetPaise && <p className="pill" role="status">Goal reached. Thank you, everyone!</p>}
                {goal.archivedAt && <p className="pill">Archived goal - history and confirmed progress retained</p>}
                <p className="story">{goal.description || "A meaningful part of our life together."}</p>
                <p className="goal-amount">{formatINR(goal.targetPaise)} <span>target</span></p>
                <label className="progress-label" htmlFor={`progress-${goal.id}`}>Given so far: {formatINR(goal.confirmedPaise)}</label>
                <progress id={`progress-${goal.id}`} value={Math.min(goal.confirmedPaise, goal.targetPaise)} max={goal.targetPaise} />
                {goal.targetHistory.length > 0 && <details>
                  <summary>Target changes (latest 20)</summary>
                  <ol>{goal.targetHistory.map((change) => <li key={change.version}>
                    {change.createdAt}: {formatINR(change.previousPaise)} to {formatINR(change.targetPaise)}
                  </li>)}</ol>
                </details>}
                {!preview && !(production && wishlist.paymentMode === "demo") && <GuestReport wishlist={wishlist} goal={goal} />}
              </div>
            </section>
          ))}
        </div>
        <p className="muted">Progress counts gifts the couple has confirmed, including cash gifts they have recorded.</p>
      </section>
      {wishlist.supporters.length > 0 && <section className="panel" aria-labelledby="supporters-title">
        <h2 id="supporters-title">Top supporters</h2>
        <p className="muted">Guests who chose to be listed, ranked by gift size. Amounts are never shown.</p>
        <ol className="supporters">{wishlist.supporters.map((item) => <li key={item.rank}><strong>{item.name}</strong> for {item.goalTitle}<progress aria-label={`Relative size of ${item.name}'s gift compared with the top supporter`} value={item.relativeImpact} max={100} /></li>)}</ol>
      </section>}
      <p className="privacy-note">Names, messages and amounts are seen only by the couple, unless a guest chooses to be listed as a supporter.</p>
    </article>
  );
}
