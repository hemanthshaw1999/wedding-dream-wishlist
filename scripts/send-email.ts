import { emailWorkerNeedsAttention, runEmailWorker } from "../src/server/email-worker.ts";

try {
  const outcome = await runEmailWorker();
  console.log(JSON.stringify({ event: "auth_email_worker", outcome }));
  if (emailWorkerNeedsAttention(outcome)) process.exitCode = 1;
} catch {
  console.error(JSON.stringify({ event: "auth_email_worker_failed", message: "Check approved server configuration and queue health; private error details are withheld." }));
  process.exitCode = 1;
}
