import Link from "next/link";
import { notFound } from "next/navigation";
import { OwnerControls } from "@/components/owner-controls";
import { WishlistView } from "@/components/wishlist-view";
import { AppError } from "@/lib/errors";
import { getDatabase } from "@/server/database";
import { localOrigin, requireOwner } from "@/server/http";
import { WishlistStore } from "@/server/store";
import { ClaimsStore } from "@/server/claims-store";
import { ClaimsDashboard } from "@/components/claims-dashboard";

export const dynamic = "force-dynamic";

export default async function Preview({ params }: { params: Promise<{ id: string }> }) {
  let wishlist;
  let reports;
  try {
    const owner = await requireOwner();
    wishlist = new WishlistStore(getDatabase()).getOwner((await params).id, owner);
    reports = new ClaimsStore(getDatabase()).dashboard(wishlist.id, owner);
  } catch (error) {
    if (error instanceof AppError && error.status === 404) notFound();
    if (error instanceof AppError && error.status === 401) {
      return <section className="panel"><h1>Sign-in required</h1><p>Your session is missing or expired. No wishlist information is shown.</p><Link href="/owner">Sign in to your account</Link></section>;
    }
    throw error;
  }
  return <><OwnerControls wishlist={wishlist} origin={localOrigin()} /><ClaimsDashboard wishlistId={wishlist.id} initial={reports} /><WishlistView wishlist={wishlist} preview /></>;
}
