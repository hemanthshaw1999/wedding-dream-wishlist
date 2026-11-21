import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { en } from "@/lib/strings";
import { applicationConfig } from "@/server/config";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const production = applicationConfig().mode === "production";
  return {
    title: production ? "Wedding Dream Wishlist" : "Wedding Dream Wishlist",
    description: production
      ? "Create a wedding wishlist and receive direct UPI gift reports from your guests."
      : "Create a wedding wishlist and receive direct UPI gift reports from your guests.",
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
        <nav className="navigation" aria-label="Main navigation">
          <Link className="wordmark" href="/">Dream Wishlist <span>for your happily ever after</span></Link>
          <Link href="/owner">My workspace</Link>
        </nav>
        <main id="main" className="container" tabIndex={-1}>{children}</main>
        <footer className="footer"><p>{production
          ? "Gifts go directly to the couple's own UPI account. This app never holds money. No third-party analytics."
          : `${en.demo} No third-party analytics.`}</p><Link href="/privacy">Privacy and limitations</Link></footer>
      </body>
    </html>
  );
}
