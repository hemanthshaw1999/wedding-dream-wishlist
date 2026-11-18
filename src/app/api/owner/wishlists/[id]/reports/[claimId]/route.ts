import { AppError } from "@/lib/errors";
import { apiError, assertMutation, enforceRateLimit, json, readJson, requireOwner } from "@/server/http";
import { ClaimsStore } from "@/server/claims-store";
import { getDatabase } from "@/server/database";

export async function PATCH(request: Request, context: { params: Promise<{ id: string; claimId: string }> }) {
  try {
    assertMutation(request);
    const owner = await requireOwner();
    enforceRateLimit("review-report", owner, 30);
    const body = await readJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some((key) => !["status", "version", "reason", "acknowledged"].includes(key))) throw new AppError(422, "VALIDATION", "Send status, version, reason and acknowledgement.");
    const { status, version, reason, acknowledged } = body as Record<string, unknown>;
    if (status === "owner_confirmed" && acknowledged !== true) throw new AppError(422, "ACKNOWLEDGEMENT_REQUIRED", "Explicitly acknowledge that this is manual confirmation, not bank verification.");
    const { id, claimId } = await context.params;
    return json(new ClaimsStore(getDatabase()).resolve(id, claimId, owner, status, version, reason));
  } catch (error) { return apiError(error); }
}
