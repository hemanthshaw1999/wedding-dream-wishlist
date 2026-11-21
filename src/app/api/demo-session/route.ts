import { json } from "@/server/http";

export function POST() {
  return json({ error: { code: "RETIRED", message: "Shared entry is disabled. Create and verify your own account." } }, 410);
}
