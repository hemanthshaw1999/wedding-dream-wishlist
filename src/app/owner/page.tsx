import { OwnerWorkspace } from "@/components/owner-workspace";
import { AppError } from "@/lib/errors";
import { getDatabase } from "@/server/database";
import { requireOwner } from "@/server/http";
import { WishlistStore } from "@/server/store";
import { applicationConfig } from "@/server/config";

export const dynamic = "force-dynamic";

export default async function OwnerPage() {
  let wishlists = null;
  try {
    const owner = await requireOwner();
    wishlists = await new WishlistStore(getDatabase()).listOwner(owner);
  } catch (error) {
    if (!(error instanceof AppError) || error.status !== 401) throw error;
  }
  return <OwnerWorkspace wishlists={wishlists} authDemo={applicationConfig().mode === "demo"} />;
}
