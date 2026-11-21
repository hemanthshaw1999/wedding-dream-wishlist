import { validateHostRsvpUpdate } from "@/lib/guests";
import { apiError, assertMutation, enforceRateLimit, json, readJson, requireOwner } from "@/server/http";
import { GuestsStore } from "@/server/guests-store";
import { getDatabase } from "@/server/database";

export async function DELETE(request: Request, context: { params: Promise<{ id: string; guestId: string }> }) {
  try {
    assertMutation(request);
    const owner = await requireOwner();
    await enforceRateLimit("guest-remove", owner, 30);
    const params = await context.params;
    return json(await new GuestsStore(getDatabase()).remove(params.id, params.guestId, owner));
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string; guestId: string }> }) {
  try {
    assertMutation(request);
    const owner = await requireOwner();
    await enforceRateLimit("host-rsvp", owner, 30);
    const params = await context.params;
    return json(await new GuestsStore(getDatabase()).recordAnswer(params.id, params.guestId, owner, validateHostRsvpUpdate(await readJson(request))));
  } catch (error) { return apiError(error); }
}
