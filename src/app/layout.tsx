import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { en } from "@/lib/strings";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wedding Dream Wishlist - Local demo",
  description: "Synthetic local demonstration. No real money.",
  robots: { index: false, follow: false }
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await connection();
  return (
    <html lang="en">
      <body>
        <a href="#main" className="skip-link">Skip to content</a>
        <div className="demo-banner">{en.demo} Local synthetic-data application.</div>
        <nav className="navigation" aria-label="Main navigation">
          <Link className="wordmark" href="/">Dream Wishlist <span>for a life together</span></Link>
          <Link href="/owner">My workspace</Link>
        </nav>
        <main id="main" className="container" tabIndex={-1}>{children}</main>
        <footer className="footer"><p>{en.demo} No payment processing. No third-party analytics.</p><Link href="/privacy">Demo privacy and limitations</Link></footer>
      </body>
    </html>
  );
}
