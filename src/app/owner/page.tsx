import { OwnerWorkspace } from "@/components/owner-workspace";
import { AppError } from "@/lib/errors";
import { getDatabase } from "@/server/database";
import { requireOwner } from "@/server/http";
import { WishlistStore } from "@/server/store";
import { applicationConfig } from "@/server/config";
import { redirect } from "next/navigation";
import { ownerReturnPath } from "@/lib/auth-navigation";
import type { AuthEntry } from "@/components/auth-panel";

export const dynamic = "force-dynamic";

export default async function OwnerPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const returnTo = ownerReturnPath(query.next);
  const entry: AuthEntry = query.verification === "returned"
    ? query.error ? "verification-error" : "verification-return"
    : query.mode === "sign-up" ? "sign-up" : query.mode === "recover" ? "recover" : "sign-in";
  let wishlists = null;
  let ownerId: string | null = null;
  try {
    const owner = await requireOwner();
    ownerId = owner;
    wishlists = await new WishlistStore(getDatabase()).listOwner(owner);
  } catch (error) {
    if (!(error instanceof AppError) || error.status !== 401) throw error;
  }
  if (ownerId && returnTo !== "/owner") redirect(returnTo);
  return <OwnerWorkspace key={ownerId ?? "signed-out"} wishlists={wishlists} session={{ ownerId }} entry={entry} returnTo={returnTo} authDemo={applicationConfig().mode === "demo"} />;
}
