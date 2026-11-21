import { apiError, assertMutation, enforceRateLimit, json, readJson } from "@/server/http";
import { AppError } from "@/lib/errors";
import { ClaimsStore } from "@/server/claims-store";
import { getDatabase } from "@/server/database";

export async function POST(request: Request) {
  try {
    assertMutation(request);
    await enforceRateLimit("guest-status", "local-computer", 60);
    const body = await readJson(request);
    if (!body || typeof body !== "object" || !("token" in body) || Object.keys(body).length !== 1) throw new AppError(404, "NOT_FOUND", "This gift was not found. The link may have expired.");
    return json(await new ClaimsStore(getDatabase()).status(body.token));
  } catch (error) { return apiError(error); }
}
