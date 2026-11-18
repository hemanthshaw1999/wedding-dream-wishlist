import { expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createTestDatabase } from "./db-fixture";
import { createAuth } from "../src/server/auth";
import { WishlistStore } from "../src/server/store";
import { ClaimsStore } from "../src/server/claims-store";
import { validateWishlist } from "../src/lib/wishlist";
import { validateClaim } from "../src/lib/claims";

it("restores nonempty authentication and confirmed ledger data from a consistent native snapshot", async () => {
  const fixture = await createTestDatabase({ environment: "synthetic-demo-only", restrictedRuntime: true });
  let dump: string | undefined;
  try {
    const db = fixture.db;
    await db.run("INSERT INTO users VALUES('owner','fictional-demo',$1)", [new Date().toISOString()]);
    const store = new WishlistStore(db);
    const wishlist = await store.create("owner", validateWishlist({ displayNames: "Fictional couple", slug: "backup-couple",
      visibility: "unlisted", goals: [{ title: "Test goal", target: "1000" }] }));
    await store.transition(wishlist.id, "owner", "published", 1);
    const claims = new ClaimsStore(db);
    const claim = await claims.report(wishlist.slug, validateClaim({ goalId: wishlist.goals[0].id,
      recipientSnapshotId: wishlist.recipientSnapshot?.id, amount: "500", currency: "INR", token: randomBytes(32).toString("hex") }));
    await claims.resolve(wishlist.id, claim.id, "owner", "owner_confirmed", 1, "Synthetic fixture only");
    const origin = "http://127.0.0.1:4317";
    const auth = createAuth({ database: db, origin, secret: randomBytes(48).toString("hex") });
    const signup = await auth.handler(new Request(`${origin}/api/auth/sign-up/email`, { method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ email: "backup@example.test", password: "Fictional-backup-test-only!42", name: "Fictional" }) }));
    expect(signup.status).toBe(200);
    const result = await promisify(execFile)(process.execPath, ["--experimental-strip-types", "scripts/backup.ts"], {
      env: { ...process.env, DEMO_MODE: "local-only", DATABASE_URL: fixture.runtimeUrl }, timeout: 50000
    });
    const line = result.stdout.trim().split("\n").find((value) => value.startsWith("PostgreSQL consistent-snapshot"));
    expect(line).toContain("checks passed:");
    dump = line?.split("checks passed: ")[1]?.trim();
    if (!dump || dirname(dump) !== resolve("data", "backups")) throw new Error("Unexpected backup artifact path.");
  } finally {
    if (dump && dirname(dump) === resolve("data", "backups")) unlinkSync(dump);
    await fixture.cleanup();
  }
}, 60000);
