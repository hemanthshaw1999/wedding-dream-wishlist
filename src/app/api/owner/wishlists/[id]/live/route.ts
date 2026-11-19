import { apiError, assertMutation, enforceRateLimit, json, readJson, requireRecentOwner } from "@/server/http";
import { WishlistStore } from "@/server/store";
import { getDatabase } from "@/server/database";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  try {
    assertMutation(request);
    const owner = await requireRecentOwner();
    await enforceRateLimit("live-activation", owner, 5);
    return json(await new WishlistStore(getDatabase()).activateLive((await context.params).id, owner, await readJson(request)));
  } catch (error) { return apiError(error); }
}
