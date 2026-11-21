import { apiError, assertMutation, enforceRateLimit, applicationOrigin, readJson, json, tokenHash } from "@/server/http";
import { getAuth } from "@/server/auth";
import { applicationConfig } from "@/server/config";

export async function GET(request: Request) {
  try { applicationOrigin(); return await (await getAuth()).handler(request); }
  catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    assertMutation(request);
    const body = await readJson(request);
    const endpoint = new URL(request.url).pathname;
    const email = body && typeof body === "object" && "email" in body && typeof body.email === "string" ? body.email.toLowerCase().trim() : "local";
    // Revoking a session must not compete with shared password/email attempt budgets.
    if (endpoint !== "/api/auth/sign-out") {
      await enforceRateLimit("auth-global", "application", 100);
      await enforceRateLimit(`auth:${endpoint}`, tokenHash(email), endpoint.endsWith("/sign-in/email") ? 8 : 5);
    }
    if (new URL(request.url).pathname.endsWith("/sign-up/email")) {
      if (applicationConfig().mode === "demo" && (!body || typeof body !== "object" || !("email" in body) ||
        typeof body.email !== "string" || !/^[a-z0-9._+-]{1,64}@example\.test$/i.test(body.email))) {
        return json({ error: { code: "SYNTHETIC_ONLY", message: "Use a name@example.test address in this local-only environment." } }, 422);
      }
      if (body && typeof body === "object" && "image" in body) return json({ error: { code: "IMAGE_DISABLED", message: "Remote profile images are disabled." } }, 422);
    }
    return await (await getAuth()).handler(new Request(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(body) }));
  } catch (error) { return apiError(error); }
}
