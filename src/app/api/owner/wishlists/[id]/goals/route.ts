import { apiError, assertMutation, enforceRateLimit, json, readJson, requireOwner } from "@/server/http";
import { getDatabase } from "@/server/database";
import { WishlistStore } from "@/server/store";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const owner = await requireOwner();
    return json(await new WishlistStore(getDatabase()).goalHistory((await context.params).id, owner));
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request, context: Context) {
  try {
    assertMutation(request);
    const owner = await requireOwner();
    await enforceRateLimit("change-goals", owner, 30);
    return json(await new WishlistStore(getDatabase()).changeGoals((await context.params).id, owner, await readJson(request)));
  } catch (error) { return apiError(error); }
}
