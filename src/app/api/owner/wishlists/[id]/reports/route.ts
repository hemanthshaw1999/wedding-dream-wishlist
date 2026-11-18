import { apiError, json, requireOwner } from "@/server/http";
import { ClaimsStore } from "@/server/claims-store";
import { getDatabase } from "@/server/database";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const owner = await requireOwner();
    const params = new URL(request.url).searchParams;
    return json(await new ClaimsStore(getDatabase()).dashboard((await context.params).id, owner, params.get("status") || "all", Number(params.get("page") || "1")));
  } catch (error) { return apiError(error); }
}
