import { apiError, json, localOrigin } from "@/server/http";
import { WishlistStore } from "@/server/store";
import { getDatabase } from "@/server/database";

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    localOrigin();
    return json(await new WishlistStore(getDatabase()).getPublic((await context.params).slug));
  } catch (error) { return apiError(error); }
}
