import Link from "next/link";
import { en } from "@/lib/strings";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <>
      <header className="hero home-hero">
        <p className="eyebrow">Meaningful wedding wishes, thoughtfully shared</p>
        <span className="ornament" aria-hidden="true">*</span>
        <h1>A little future,<br />dreamed together.</h1>
        <p className="story">Create a wedding wishlist of experiences and goals. Preview your story, save it locally and explore what your guests will see.</p>
        <div className="actions centered"><Link className="button" href="/owner?mode=sign-up">Create a fictional wishlist</Link><Link className="button secondary" href="/owner">Sign in to your workspace</Link></div>
      </header>
      <section className="notice"><strong>{en.demo}</strong><p>Create with fictional details only. Real payments, real email and public hosting are not enabled in this local version. Preview your own guest page after saving a draft.</p></section>
      <section className="feature-grid" aria-label="Demo capabilities">
        <div className="panel"><p className="eyebrow">01 / Create</p><h2>Dreams with detail</h2><p>Names, a story and goals with INR targets. Save a draft before deciding what to share.</p></div>
        <div className="panel"><p className="eyebrow">02 / Preview</p><h2>Thoughtful by default</h2><p>Private owner preview and explicit visibility. No guest names or messages made public.</p></div>
        <div className="panel"><p className="eyebrow">03 / Share locally</p><h2>A link to your story</h2><p>Anonymous guest view and a wishlist-link QR. Payment and public hosting remain disabled.</p></div>
      </section>
    </>
  );
}
