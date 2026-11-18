import Link from "next/link";

export default function NotFound() {
  return <section className="panel"><h1>Wishlist not available</h1><p>This link may be incorrect, private, still a draft or archived. No payment has been initiated.</p><Link href="/">Return to the demo home</Link></section>;
}
