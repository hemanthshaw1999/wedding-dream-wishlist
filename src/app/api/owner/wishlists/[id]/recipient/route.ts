import { apiError, assertMutation, enforceRateLimit, json, readJson, requireOwner, requireRecentOwner } from "@/server/http";
import { WishlistStore } from "@/server/store";
import { getDatabase } from "@/server/database";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const owner = await requireOwner();
    return json({ versions: await new WishlistStore(getDatabase()).recipientVersions((await context.params).id, owner) });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    assertMutation(request);
    const owner = await requireRecentOwner();
    await enforceRateLimit("recipient-setup", owner, 10);
    const recipient = await new WishlistStore(getDatabase()).addRecipientVersion((await context.params).id, owner, await readJson(request));
    return json({ recipient }, 201);
  } catch (error) { return apiError(error); }
}
