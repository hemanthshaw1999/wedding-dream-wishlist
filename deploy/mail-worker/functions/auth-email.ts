import { emailWorkerNeedsAttention, runEmailWorker } from "../../../src/server/email-worker.ts";

export default async function authEmail() {
  try {
    const outcome = await runEmailWorker();
    console.log(JSON.stringify({ event: "auth_email_worker", outcome }));
    if (emailWorkerNeedsAttention(outcome)) throw new Error("Worker outcome requires attention.");
  } catch {
    console.error(JSON.stringify({ event: "auth_email_worker_failed" }));
    throw new Error("Authentication email worker failed; private details are withheld.");
  }
}
