import { apiError, assertMutation, enforceRateLimit, json, readJson, requireOwner } from "@/server/http";
import { CashStore, validateCashGift } from "@/server/cash-store";
import { getDatabase } from "@/server/database";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const owner = await requireOwner();
    return json(await new CashStore(getDatabase()).list((await context.params).id, owner));
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertMutation(request);
    const owner = await requireOwner();
    await enforceRateLimit("cash-gift", owner, 30);
    const input = validateCashGift(await readJson(request));
    return json(await new CashStore(getDatabase()).add((await context.params).id, owner, input));
  } catch (error) { return apiError(error); }
}
