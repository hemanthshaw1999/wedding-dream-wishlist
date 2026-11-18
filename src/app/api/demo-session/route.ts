import { json } from "@/server/http";

export function POST() {
  return json({ error: { code: "RETIRED", message: "Shared demo entry is disabled. Create and verify your own local test account." } }, 410);
}
