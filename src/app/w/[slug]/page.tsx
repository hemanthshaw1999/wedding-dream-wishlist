import { notFound } from "next/navigation";
import { WishlistView } from "@/components/wishlist-view";
import { AppError } from "@/lib/errors";
import { getDatabase } from "@/server/database";
import { localOrigin } from "@/server/http";
import { WishlistStore } from "@/server/store";

export const dynamic = "force-dynamic";

export default async function GuestPage({ params }: { params: Promise<{ slug: string }> }) {
  let wishlist;
  try {
    localOrigin();
    wishlist = await new WishlistStore(getDatabase()).getPublic((await params).slug);
  } catch (error) {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  }
  return <WishlistView wishlist={wishlist} />;
}
