import { apiError, assertMutation, enforceRateLimit, json, readJson, requireOwner } from "@/server/http";
import { GuestsStore } from "@/server/guests-store";
import { validateGuestName, validateGuestNames } from "@/lib/guests";
import { getDatabase } from "@/server/database";
import { AppError } from "@/lib/errors";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const owner = await requireOwner();
    return json(await new GuestsStore(getDatabase()).list((await context.params).id, owner));
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    assertMutation(request);
    const owner = await requireOwner();
    await enforceRateLimit("guest-add", owner, 30);
    const body = await readJson(request);
    const id = (await context.params).id;
    if (body && typeof body === "object" && !Array.isArray(body) && "names" in body) {
      return json(await new GuestsStore(getDatabase()).addMany(id, owner, validateGuestNames(body).names));
    }
    if (body && typeof body === "object" && !Array.isArray(body) && "name" in body) {
      return json(await new GuestsStore(getDatabase()).add(id, owner, validateGuestName(body).name));
    }
    throw new AppError(422, "VALIDATION", "Send a guest name or a names list.");
  } catch (error) { return apiError(error); }
}
