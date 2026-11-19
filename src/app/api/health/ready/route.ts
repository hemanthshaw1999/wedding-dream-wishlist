import { randomUUID } from "node:crypto";
import { getDatabase } from "@/server/database";
import { assertApplicationReady } from "@/server/readiness";
import { json } from "@/server/http";

export async function GET() {
  try {
    await assertApplicationReady(getDatabase());
    return json({ status: "ready" });
  } catch {
    const correlationId = randomUUID();
    console.error(JSON.stringify({ event: "readiness_failed", correlationId }));
    return json({ status: "unavailable", correlationId }, 503);
  }
}
