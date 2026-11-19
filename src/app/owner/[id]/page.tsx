import Link from "next/link";
import { notFound } from "next/navigation";
import { OwnerControls } from "@/components/owner-controls";
import { OwnerRecipient } from "@/components/owner-recipient";
import { WishlistView } from "@/components/wishlist-view";
import { AppError } from "@/lib/errors";
import { getDatabase } from "@/server/database";
import { applicationOrigin, requireOwner } from "@/server/http";
import { applicationConfig } from "@/server/config";
import { WishlistStore } from "@/server/store";
import { ClaimsStore } from "@/server/claims-store";
import { ClaimsDashboard } from "@/components/claims-dashboard";
import { ownerReturnPath } from "@/lib/auth-navigation";

export const dynamic = "force-dynamic";

export default async function Preview({ params }: { params: Promise<{ id: string }> }) {
  let wishlist;
  let reports;
  try {
    const owner = await requireOwner();
    const id = (await params).id;
    ({ wishlist, reports } = await getDatabase().readSnapshot(async (tx) => {
      const wishlist = await new WishlistStore(tx).getOwner(id, owner);
      const reports = await new ClaimsStore(tx).dashboard(id, owner);
      return { wishlist, reports };
    }));
  } catch (error) {
    if (error instanceof AppError && error.status === 404) notFound();
    if (error instanceof AppError && error.status === 401) {
      const returnTo = ownerReturnPath(`/owner/${(await params).id}`);
      return <section className="panel prose"><h1>Sign-in required</h1><p>Your session is missing or expired. Sign in to return to this wishlist. No wishlist information is shown.</p><Link className="button" href={`/owner?${new URLSearchParams({ next: returnTo })}`}>Sign in to your account</Link></section>;
    }
    throw error;
  }
  return <><header className="page-title"><Link href="/owner">Back to workspace</Link><p className="eyebrow">Your private management view</p><h1>{wishlist.displayNames}</h1><nav className="actions section-nav" aria-label="Wishlist sections"><a href="#publication">Publish and share</a><a href="#payment-setup">Payment setup</a><a href="#manage-goals-title">Manage goals</a><a href="#reports-title">Guest reports</a><a href="#guest-preview">Guest preview</a></nav></header><OwnerControls wishlist={wishlist} origin={applicationOrigin()} production={applicationConfig().mode === "production"} /><OwnerRecipient wishlist={wishlist} production={applicationConfig().mode === "production"} /><ClaimsDashboard wishlistId={wishlist.id} initial={reports} live={wishlist.paymentMode === "upi"} production={applicationConfig().mode === "production"} /><section id="guest-preview" aria-label="Guest preview"><WishlistView wishlist={wishlist} preview /></section></>;
}
