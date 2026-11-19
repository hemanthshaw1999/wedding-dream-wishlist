import { apiError, assertMutation, enforceRateLimit, json, requireOwner } from "@/server/http";
import { CashStore } from "@/server/cash-store";
import { getDatabase } from "@/server/database";

export async function DELETE(request: Request, context: { params: Promise<{ id: string; giftId: string }> }) {
  try {
    assertMutation(request);
    const owner = await requireOwner();
    await enforceRateLimit("cash-gift-void", owner, 30);
    const { id, giftId } = await context.params;
    return json(await new CashStore(getDatabase()).void(id, giftId, owner));
  } catch (error) { return apiError(error); }
}
