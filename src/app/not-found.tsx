import Link from "next/link";

export default function NotFound() {
  return <section className="panel"><h1>Link not available</h1><p>This link may be incorrect, replaced, private or no longer available. No payment has been initiated.</p><Link href="/">Return to the home page</Link></section>;
}
