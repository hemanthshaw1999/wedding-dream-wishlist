import { validateClaim } from "@/lib/claims";
import { getDatabase } from "@/server/database";
import { ClaimsStore } from "@/server/claims-store";
import { apiError, assertMutation, enforceRateLimit, json, readJson } from "@/server/http";

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    assertMutation(request);
    enforceRateLimit("guest-report", "local-computer", 30);
    const input = validateClaim(await readJson(request));
    return json(new ClaimsStore(getDatabase()).report((await context.params).slug, input), 200);
  } catch (error) { return apiError(error); }
}
