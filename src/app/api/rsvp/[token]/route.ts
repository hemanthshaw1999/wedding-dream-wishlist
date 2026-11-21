import { apiError, assertMutation, enforceRateLimit, json, readJson, applicationOrigin } from "@/server/http";
import { GuestsStore } from "@/server/guests-store";
import { validateRsvpUpdate } from "@/lib/guests";
import { getDatabase } from "@/server/database";

type Context = { params: Promise<{ token: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    applicationOrigin();
    return json(await new GuestsStore(getDatabase()).view((await context.params).token));
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    assertMutation(request);
    const token = (await context.params).token;
    await enforceRateLimit("rsvp-answer", token.slice(0, 16), 20);
    const input = validateRsvpUpdate(await readJson(request));
    return json(await new GuestsStore(getDatabase()).answer(token, input));
  } catch (error) { return apiError(error); }
}
