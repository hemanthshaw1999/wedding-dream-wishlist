import { apiError, assertMutation, enforceRateLimit, json, requireOwner } from "@/server/http";
import { GuestsStore } from "@/server/guests-store";
import { getDatabase } from "@/server/database";

export async function POST(request: Request, context: { params: Promise<{ id: string; guestId: string }> }) {
  try {
    assertMutation(request);
    const owner = await requireOwner();
    await enforceRateLimit("guest-invite-reset", owner, 30);
    const params = await context.params;
    return json(await new GuestsStore(getDatabase()).resetInvite(params.id, params.guestId, owner));
  } catch (error) { return apiError(error); }
}
