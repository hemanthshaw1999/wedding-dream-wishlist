import { AppError } from "@/lib/errors";
import { apiError, assertMutation, enforceRateLimit, json, readJson, requireOwner } from "@/server/http";
import { WishlistStore } from "@/server/store";
import { getDatabase } from "@/server/database";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const owner = await requireOwner();
    return json(await new WishlistStore(getDatabase()).getOwner((await context.params).id, owner));
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request, context: Context) {
  try {
    assertMutation(request);
    const owner = await requireOwner();
    await enforceRateLimit("change-state", owner, 20);
    const body = await readJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some((key) => !["state", "version"].includes(key))) {
      throw new AppError(422, "VALIDATION", "Send only state and version.");
    }
    const { state, version } = body as Record<string, unknown>;
    return json(await new WishlistStore(getDatabase()).transition((await context.params).id, owner, state, version));
  } catch (error) { return apiError(error); }
}
