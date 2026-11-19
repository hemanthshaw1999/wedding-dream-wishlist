import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { en } from "@/lib/strings";
import { applicationConfig } from "@/server/config";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const production = applicationConfig().mode === "production";
  return {
    title: production ? "Wedding Dream Wishlist" : "Wedding Dream Wishlist - Local demo",
    description: production
      ? "Create a wedding wishlist and receive direct UPI gift reports from your guests."
      : "Synthetic local demonstration. No real money.",
    robots: { index: false, follow: false }
  };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await connection();
  const production = applicationConfig().mode === "production";
  return (
    <html lang="en">
      <body>
        <a href="#main" className="skip-link">Skip to content</a>
        {!production && <div className="demo-banner">{en.demo} Local synthetic-data application.</div>}
        <nav className="navigation" aria-label="Main navigation">
          <Link className="wordmark" href="/">Dream Wishlist <span>for a life together</span></Link>
          <Link href="/owner">My workspace</Link>
        </nav>
        <main id="main" className="container" tabIndex={-1}>{children}</main>
        <footer className="footer"><p>{production
          ? "Gifts go directly to the couple's own UPI account. This app never holds money. No third-party analytics."
          : `${en.demo} No payment processing. No third-party analytics.`}</p><Link href="/privacy">{production ? "Privacy and limitations" : "Demo privacy and limitations"}</Link></footer>
      </body>
    </html>
  );
}
