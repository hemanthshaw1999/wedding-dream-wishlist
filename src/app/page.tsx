import Link from "next/link";
import { WeddingMark, WeddingFlourish, WeddingGarland } from "@/components/wedding-mark";
import { applicationConfig } from "@/server/config";

export const dynamic = "force-dynamic";

export default function Home() {
  const production = applicationConfig().mode === "production";
  return (
    <>
      <header className="hero home-hero">
        <p className="eyebrow">Meaningful wedding wishes, thoughtfully shared</p>
        <WeddingFlourish /><WeddingGarland /><WeddingMark />
        <h1>A little future,<br />dreamed together.</h1>
        <p className="story">Your people, your shared dreams, and a little love for your next chapter.</p>
        <div className="actions centered"><Link className="button" href="/owner?mode=sign-up">Create your wishlist</Link><Link className="button secondary" href="/owner">Sign in to your workspace</Link></div>
      </header>
      {production && <section className="notice">
        <strong>Gifts go directly to the couple.</strong>
        <p>Guests pay your own UPI ID in their UPI app and tell you here. You confirm each gift against your bank records. The app never holds money and charges no fee.</p>
      </section>}
      <section className="feature-grid" aria-label="Capabilities">
        <div className="panel"><p className="eyebrow">01 / Create</p><h2>Dreams with detail</h2><p>Write the goals you really want, each with an INR budget. Guests can fund any part of a goal, so no single person has to cover it.</p></div>
        <div className="panel"><p className="eyebrow">02 / Preview</p><h2>Thoughtful by default</h2><p>Private owner preview and explicit visibility. Guest messages stay private. Names appear only when guests choose to be listed.</p></div>
        <div className="panel"><p className="eyebrow">03 / Share</p><h2>A link to your story</h2><p>Anonymous guest view and a wishlist-link QR that works on any phone.</p></div>
      </section>
    </>
  );
}
