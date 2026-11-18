import { apiError, assertMutation, enforceRateLimit, json, readJson, requireOwner } from "@/server/http";
import { validateWishlist } from "@/lib/wishlist";
import { WishlistStore } from "@/server/store";
import { getDatabase } from "@/server/database";

export async function GET() {
  try { return json({ wishlists: new WishlistStore(getDatabase()).listOwner(await requireOwner()) }); }
  catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    assertMutation(request);
    const owner = await requireOwner();
    enforceRateLimit("create-wishlist", owner, 10);
    const input = validateWishlist(await readJson(request));
    return json(new WishlistStore(getDatabase()).create(owner, input), 201);
  } catch (error) { return apiError(error); }
}
