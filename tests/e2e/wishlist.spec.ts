import { expect, test, type APIRequestContext, type Locator } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { openDatabase } from "../../src/server/database";

// Open optional tools through their visible summary, as a guest/owner would.
async function reveal(target: Locator) {
  await target.waitFor({ state: "attached" });
  const ancestors = target.locator("xpath=ancestor::details[not(@open)]");
  while (await ancestors.count()) await ancestors.first().locator(":scope > summary").click();
}

const origin = "http://127.0.0.1:4318";
const password = "Fictional-test-only-password!42";
const fixture = () => ({
  displayNames: "तारा & Arjun 💛", story: "<script>window.__xss=true</script> Fictional only",
  slug: `test-${randomUUID()}`, visibility: "unlisted",
  goals: [{ title: "Our honeymoon", description: "A quiet adventure", target: "300000" }]
});
function e2eDatabase() {
  const name = process.env.E2E_DB_NAME;
  if (!name || !/^wishlist_e2e_[a-f0-9]{32}$/.test(name)) throw new Error("Missing isolated E2E database name.");
  const adminUrl = process.env.WISHLIST_TEST_ADMIN_URL ||
    (JSON.parse(readFileSync(resolve("data", "local-postgres.json"), "utf8")) as { adminUrl: string }).adminUrl;
  const url = new URL(adminUrl);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("E2E refuses a remote database.");
  url.pathname = `/${name}`;
  return openDatabase(url.toString());
}
const verificationLink = (email: string) => mailboxLink(email, "verification");
async function mailboxLink(email: string, kind: "verification" | "recovery"): Promise<string> {
  const db = e2eDatabase();
  try {
    const entry = await db.get("SELECT url FROM auth_local_outbox WHERE recipient=$1 AND kind=$2 ORDER BY created_at DESC LIMIT 1", [email, kind]);
    if (!entry) throw new Error("No synthetic authentication message was queued.");
    return String(entry.url);
  } finally { await db.close(); }
}
async function account(request: APIRequestContext) {
  const email = `${randomUUID()}@example.test`;
  expect((await request.post("/api/auth/sign-up/email", { data: { name: "Fictional owner", email, password, callbackURL: "/owner" }, headers: { Origin: origin } })).status()).toBe(200);
  await request.get(await verificationLink(email));
  expect((await request.post("/api/auth/sign-in/email", { data: { email, password }, headers: { Origin: origin } })).status()).toBe(200);
  return email;
}

test("verified account, persisted wishlist, anonymous report and audited manual confirmation", async ({ page, browser }, testInfo) => {
  await page.route("**/owner", async (route) => {
    const response = await route.fetch();
    const html = await response.text();
    await route.fulfill({ response, body: html.replace("</head>",
      `<script id="untrusted-csp-probe">document.documentElement.dataset.unauthorizedScript="executed"</script></head>`) });
  });
  const initial = await page.goto("/owner");
  await page.unroute("**/owner");
  const policy = initial?.headers()["content-security-policy"] ?? "";
  const nonce = policy.match(/'nonce-([^']+)'/)?.[1];
  expect(nonce).toBeDefined();
  expect(policy.split(";").find((part) => part.trim().startsWith("script-src"))).not.toContain("'unsafe-inline'");
  expect(await page.evaluate((expected) => Array.from(document.scripts)
    .every((script) => script.id === "untrusted-csp-probe" || script.nonce === expected), nonce)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.dataset.unauthorizedScript)).toBeUndefined();
  await page.getByRole("button", { name: "Create an account", exact: true }).click();
  const email = `${randomUUID()}@example.test`;
  await page.getByRole("radio", { name: "Bride", exact: true }).check();
  await page.getByLabel("Your display name").fill("Fictional owner");
  await page.getByLabel("Account email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "verification message" })).toBeVisible();
  await page.goto(await verificationLink(email));
  await page.getByLabel("Account email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await reveal(page.getByLabel("Couple display names"));
  await page.getByLabel("Couple display names").fill("तारा & Arjun 💛");
  await reveal(page.getByLabel("Your love story"));
  await page.getByLabel("Your love story").fill("<script>window.__xss=true</script> Fictional only");
  const slug = `browser-${randomUUID()}`;
  await page.getByLabel("Share slug").fill(slug);
  await page.getByLabel("Goal title", { exact: true }).fill("Our honeymoon");
  await page.getByLabel("Target amount").fill("300000");
  await page.getByRole("button", { name: "Save draft and preview" }).click();
  await expect(page.getByRole("heading", { name: "तारा & Arjun 💛" })).toBeVisible();
  await expect(page.getByText("Status: draft")).toBeVisible();
  await page.reload();
  const visitor = await browser.newContext({ baseURL: origin });
  const guest = await visitor.newPage();
  expect((await guest.goto(`/w/${slug}`))?.status()).toBe(404);
  await page.getByRole("button", { name: "Publish after preview" }).click();
  await expect(page.getByLabel("Guest link")).toHaveValue(`${origin}/w/${slug}`);
  await page.getByRole("button", { name: "Create link QR" }).click();
  await expect(page.getByRole("img", { name: /not a payment QR/ })).toBeVisible();
  await guest.goto(`${origin}/w/${slug}`);
  await expect(guest.getByRole("heading", { name: "तारा & Arjun 💛" })).toBeVisible();
  await expect(guest.getByText("Given so far: ₹0")).toBeVisible();
  expect(await guest.evaluate(() => "__xss" in window)).toBe(false);
  expect(await guest.locator("body").innerText()).toContain("<script>window.__xss=true</script>");
  expect((await guest.request.get("/api/owner/wishlists")).status()).toBe(401);
  const projection = await (await guest.request.get(`/api/public/wishlists/${slug}`)).json();
  expect(projection).not.toHaveProperty("id"); expect(projection).not.toHaveProperty("version");
  const secretCookie = (await page.context().cookies()).find((cookie) => cookie.name.endsWith("session_token"));
  expect(secretCookie?.httpOnly).toBe(true); expect(secretCookie?.sameSite).toBe("Strict");
  expect(await page.getByLabel("Guest link").inputValue()).not.toContain(secretCookie?.value || "missing");
  await guest.getByRole("button", { name: "Choose a gift" }).click();
  await reveal(guest.getByLabel(/^Your name/));
  await guest.getByLabel(/^Your name/).fill("=1+1");
  await guest.getByLabel("Your wishes for the couple").fill("A private fictional message");
  await guest.getByRole("button", { name: "Continue" }).click();
  await expect(guest.getByRole("img", { name: "Illustrative QR - not payable and not a UPI QR" })).toBeVisible();
  await expect(guest.locator(".wishes-preview")).toContainText("A private fictional message");
  // Demo mode carries no payment intent: no upi:// link, no pay button, no UPI ID to copy.
  await expect(guest.locator('a[href^="upi:"]')).toHaveCount(0);
  await expect(guest.getByRole("link", { name: /with your UPI app/ })).toHaveCount(0);
  await expect(guest.getByRole("button", { name: "Copy UPI ID" })).toHaveCount(0);
  await guest.getByRole("checkbox").check();
  await guest.getByRole("button", { name: "Send to the couple", exact: true }).click();
  await expect(guest.getByRole("heading", { name: "Thank you! The couple has been told." })).toBeVisible();
  await expect(guest.locator(".gift-celebration .wedding-mark")).toBeVisible();
  await expect(guest.locator(".wedding-teddies")).toHaveCount(0);
  await guest.locator(".gift-celebration").screenshot({ path: `test-results/${testInfo.project.name}-rings-thankyou.png` });
  await expect(guest.getByLabel("Your status link")).not.toBeVisible();
  await guest.getByText("Show status link", { exact: true }).click();
  const privateUrl = await guest.getByLabel("Your status link").inputValue();
  await guest.getByText("Show status link", { exact: true }).click();
  await guest.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
    writeText: async (text: string) => { sessionStorage.setItem("test-copied-status", text); }
  } }));
  await guest.getByRole("button", { name: "Copy status link", exact: true }).click();
  await expect(guest.getByRole("button", { name: "Status link copied", exact: true })).toBeVisible();
  expect(await guest.evaluate(() => sessionStorage.getItem("test-copied-status"))).toBe(privateUrl);
  await guest.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
    writeText: async () => { throw new Error("Synthetic clipboard denial"); }
  } }));
  await guest.getByRole("button", { name: "Status link copied", exact: true }).click();
  await expect(guest.getByLabel("Your status link")).toBeVisible();
  await expect(guest.locator(".gift-status-actions").getByRole("alert")).toContainText("Automatic copy is unavailable");
  expect(new URL(privateUrl).hash.length).toBe(65);
  const replayBody = { goalId: projection.goals[0].id, recipientSnapshotId: projection.recipientSnapshot.id,
    amount: "500", currency: "INR", guestName: "=1+1", guestMessage: "A private fictional message",
    reference: "", token: new URL(privateUrl).hash.slice(1) };
  const retries = await Promise.all([0, 1].map(() => guest.request.post(`/api/public/wishlists/${slug}/reports`, {
    data: replayBody, headers: { Origin: origin }
  })));
  expect(retries.map((response) => response.status())).toEqual([200, 200]);
  expect((await retries[0].json()).id).toBe((await retries[1].json()).id);
  await expect(guest.getByText("Given so far: ₹0")).toBeVisible();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("heading", { name: "₹500 - =1+1" })).toBeVisible();
  const ownerId = new URL(page.url()).pathname.split("/").at(-1);
  const pending = await (await page.request.get(`/api/owner/wishlists/${ownerId}/reports`)).json();
  expect(pending.total).toBe(1);
  expect((await page.request.patch(`/api/owner/wishlists/${ownerId}/reports/${pending.claims[0].id}`, {
    data: { status: "owner_confirmed", version: 1, reason: "Missing acknowledgement" }, headers: { Origin: origin }
  })).status()).toBe(422);
  if (!(await page.getByLabel("Note for your records").isVisible())) await page.getByRole("button", { name: "Review gift", exact: true }).first().click();
  await page.getByLabel("Note for your records").fill("Matched fictional bank record in synthetic test");
  await page.getByLabel("I have checked this against my own bank").check();
  await page.getByRole("button", { name: "Confirm gift" }).click();
  await reveal(page.getByText("Given so far: ₹500"));
  await expect(async () => { await reveal(page.getByText("Given so far: ₹500")); await expect(page.getByText("Given so far: ₹500")).toBeVisible(); }).toPass();
  await expect(page.getByLabel("Note for your records")).toHaveValue("");
  await expect(page.getByLabel("I have checked this against my own bank")).not.toBeChecked();
  const csv = await page.request.get(`/api/owner/wishlists/${ownerId}/reports/export`);
  expect(csv.status()).toBe(200); expect(await csv.text()).toContain("\"'=1+1\"");
  await page.screenshot({ path: `test-results/${testInfo.project.name}-owner.png`, fullPage: true });
  await guest.goto(privateUrl);
  await guest.getByRole("button", { name: "Check status" }).click();
  await expect(guest.getByRole("heading", { name: "Confirmed by the couple" })).toBeVisible();
  expect(guest.url()).not.toContain("#");
  await guest.reload();
  await guest.getByRole("button", { name: "Check status" }).click();
  await expect(guest.getByRole("heading", { name: "Confirmed by the couple" })).toBeVisible();
  let releaseStatus = () => {};
  const pendingStatus = new Promise<void>((resolve) => { releaseStatus = resolve; });
  await guest.route("**/api/guest/status", async (route) => {
    const response = await route.fetch(); await pendingStatus; await route.fulfill({ response });
  });
  try {
    await guest.getByRole("button", { name: "Check status" }).click();
    await expect(guest.getByRole("button", { name: "Checking...", exact: true })).toBeDisabled();
    await guest.evaluate(() => { window.history.replaceState(null, "", "#" + "0".repeat(64)); });
    releaseStatus();
    await expect(guest.getByRole("alert").filter({ hasText: "A different private link was opened" })).toBeVisible();
    await expect(guest.getByRole("heading", { name: "Confirmed by the couple" })).not.toBeVisible();
  } finally { releaseStatus(); await guest.unroute("**/api/guest/status"); }
  await guest.goto(privateUrl);
  await guest.getByRole("button", { name: "Check status" }).click();
  await expect(guest.getByRole("heading", { name: "Confirmed by the couple" })).toBeVisible();
  await guest.route("**/api/guest/status", (route) => route.abort("failed"));
  await guest.getByRole("button", { name: "Check status" }).click();
  await expect(guest.getByRole("alert").filter({ hasText: "server could not be reached" })).toBeVisible();
  await expect(guest.getByRole("heading", { name: "Confirmed by the couple" })).not.toBeVisible();
  await guest.unroute("**/api/guest/status");
  await guest.getByRole("button", { name: "Check status" }).click();
  await expect(guest.getByRole("heading", { name: "Confirmed by the couple" })).toBeVisible();
  await guest.getByRole("button", { name: "Forget this link on this device" }).click();
  expect(await guest.evaluate(() => Object.keys(sessionStorage).some((key) => key.startsWith("wishlist-report:") || key === "wishlist-private-status"))).toBe(false);
  await guest.reload();
  await guest.getByRole("button", { name: "Check status" }).click();
  await expect(guest.getByRole("alert").filter({ hasText: "This gift was not found" })).toBeVisible();
  await expect(guest.getByRole("heading", { name: "Confirmed by the couple" })).not.toBeVisible();
  await guest.goto(`${origin}/w/${slug}`);
  expect(await guest.locator("body").innerText()).not.toContain("A private fictional message");
  await expect(guest.getByText("Given so far: ₹500")).toBeVisible();
  await guest.setViewportSize(testInfo.project.name.startsWith("mobile") ? { width: 390, height: 844 } : { width: 1280, height: 900 });
  expect(await guest.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await guest.screenshot({ path: `test-results/${testInfo.project.name}-guest.png`, fullPage: true });
  await visitor.close();
});

test("HTTP controls, real tenant isolation, concurrent changes and sign-out", async ({ request, browser }) => {
  const readiness = await request.get("/api/health/ready");
  expect(readiness.status()).toBe(200);
  expect(await readiness.json()).toEqual({ status: "ready" });
  expect(readiness.headers()["cache-control"]).toContain("no-store");
  const database = e2eDatabase();
  try {
    const grant = await database.get(`SELECT grantee FROM information_schema.role_table_grants
      WHERE table_schema='public' AND table_name='goals' AND privilege_type='INSERT'
      AND grantee LIKE 'wishlist_runtime_%'`);
    const role = String(grant?.grantee ?? "");
    if (!/^wishlist_runtime_[a-f0-9]{24}$/.test(role)) throw new Error("Missing isolated E2E runtime role.");
    await database.run(`REVOKE INSERT ON goals FROM "${role}"`);
    try {
      const unavailable = await request.get("/api/health/ready");
      expect(unavailable.status()).toBe(503);
      const body = await unavailable.json();
      expect(body).toEqual({ status: "unavailable", correlationId: expect.any(String) });
      expect(JSON.stringify(body)).not.toContain(role);
      expect(JSON.stringify(body)).not.toContain(process.env.E2E_DB_NAME);
    } finally { await database.run(`GRANT INSERT ON goals TO "${role}"`); }
    expect((await request.get("/api/health/ready")).status()).toBe(200);
  } finally { await database.close(); }
  expect((await request.post("/api/demo-session", { data: {} })).status()).toBe(410);
  expect((await request.post("/api/auth/sign-in/email", { data: {}, headers: { Origin: "https://evil.example" } })).status()).toBe(403);
  expect((await request.get("/", { headers: { Host: "evil.example" } })).status()).toBe(403);
  await account(request);
  const input = fixture();
  const responses = await Promise.all([
    request.post("/api/owner/wishlists", { data: input, headers: { Origin: origin } }),
    request.post("/api/owner/wishlists", { data: input, headers: { Origin: origin } })
  ]);
  expect(responses.map((response) => response.status()).sort()).toEqual([201, 409]);
  const wishlist = await responses.find((response) => response.status() === 201)!.json();
  const other = await browser.newContext({ baseURL: origin });
  await account(other.request);
  expect((await other.request.get(`/api/owner/wishlists/${wishlist.id}`)).status()).toBe(404);
  expect((await other.request.get(`/api/owner/wishlists/${wishlist.id}/reports`)).status()).toBe(404);
  expect((await other.request.get(`/api/owner/wishlists/${wishlist.id}/reports/export`)).status()).toBe(404);
  expect((await other.request.patch(`/api/owner/wishlists/${wishlist.id}/reports/unknown`, { data: {
    status: "owner_confirmed", version: 1, reason: "Unauthorized", acknowledged: true
  }, headers: { Origin: origin } })).status()).toBe(404);
  expect((await other.request.patch(`/api/owner/wishlists/${wishlist.id}`, { data: { state: "published", version: 1 }, headers: { Origin: origin } })).status()).toBe(404);
  await other.close();
  const transitions = await Promise.all(["published", "closed"].map((state) => request.patch(`/api/owner/wishlists/${wishlist.id}`, { data: { state, version: 1 }, headers: { Origin: origin } })));
  expect(transitions.map((response) => response.status()).sort()).toEqual([200, 409]);
  const privateInput = { ...fixture(), visibility: "private" };
  const privateWishlist = await (await request.post("/api/owner/wishlists", { data: privateInput, headers: { Origin: origin } })).json();
  expect((await request.patch(`/api/owner/wishlists/${privateWishlist.id}`, { data: { state: "published", version: 1 }, headers: { Origin: origin } })).status()).toBe(200);
  expect((await request.get(`/api/public/wishlists/${privateInput.slug}`)).status()).toBe(404);
  expect((await request.get("/api/owner/wishlists")).headers()["cache-control"]).toContain("no-store");
  expect((await request.get("/")).headers()["x-robots-tag"]).toContain("noindex");
  expect((await request.post("/api/auth/sign-out", { data: {}, headers: { Origin: origin } })).status()).toBe(200);
  expect((await request.get("/api/owner/wishlists")).status()).toBe(401);
});

test("keyboard access, responsive forms, missing session and offline retry preserve input", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
  const email = await account(page.request);
  await page.goto("/owner");
  await reveal(page.getByLabel("Couple display names"));
  await page.getByLabel("Couple display names").fill("Fictional couple");
  await page.getByLabel("Share slug").fill(`validation-${randomUUID()}`);
  await page.getByLabel("Goal title", { exact: true }).fill("A dream");
  await page.getByLabel("Target amount").fill("1e3");
  await page.getByRole("button", { name: "Save draft and preview" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "plain INR amount" })).toBeVisible();
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 320, height: 800 });
  await page.screenshot({ path: `test-results/${testInfo.project.name}-owner-form-320.png`, fullPage: true });
  await page.getByLabel("Target amount").fill("500");
  await page.context().clearCookies();
  await page.getByRole("button", { name: "Save draft and preview" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Sign in with a verified account" })).toBeVisible();
  await page.getByLabel("Account email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Target amount")).toHaveValue("500");
  await page.route("**/api/owner/wishlists", (route) => route.abort("failed"));
  await page.getByRole("button", { name: "Save draft and preview" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "The save outcome is unknown" })).toBeVisible();
  await expect(page.getByLabel("Target amount")).toHaveValue("500");
});

test("responsive goal management preserves gift history and exposes only public target revisions", async ({ page, browser }, testInfo) => {
  await account(page.request);
  const input = fixture();
  const created = await page.request.post("/api/owner/wishlists", { data: input, headers: { Origin: origin } });
  expect(created.status()).toBe(201);
  const initial = await created.json();
  await page.goto(`/owner/${initial.id}`);
  const manager = page.getByRole("region", { name: "Manage goals", exact: true });
  await reveal(manager.getByLabel("Reason for the change"));
  await manager.getByLabel("Reason for the change").fill("Private initial edit reason");
  await manager.getByRole("button", { name: "Edit Our honeymoon", exact: true }).click();
  await manager.getByLabel("Goal title", { exact: true }).fill("A quieter trip");
  await manager.getByLabel("Goal target amount").fill("1200");
  await manager.getByRole("button", { name: "Save goal", exact: true }).click();
  await expect(manager.getByRole("heading", { name: "A quieter trip", exact: true })).toBeVisible();
  await manager.getByRole("button", { name: "Add goal", exact: true }).click();
  await reveal(manager.getByLabel("Reason for the change"));
  await manager.getByLabel("Reason for the change").fill("Private added goal reason");
  await manager.getByLabel("Goal title", { exact: true }).fill("Our home");
  await manager.getByLabel("Goal target amount").fill("2000");
  await manager.getByRole("button", { name: "Save goal", exact: true }).click();
  await expect(manager.getByRole("heading", { name: "Our home", exact: true })).toBeVisible();
  await reveal(manager.getByLabel("Reason for the change"));
  await manager.getByLabel("Reason for the change").fill("Private reordered goals reason");
  await reveal(manager.getByRole("button", { name: "Move Our home up", exact: true, includeHidden: true }));
  await manager.getByRole("button", { name: "Move Our home up", exact: true }).click();
  await expect(manager.locator("ol.report-list").first().locator(":scope > li").first().getByRole("heading")).toHaveText("Our home");
  await page.getByRole("button", { name: "Publish after preview", exact: true }).click();
  await expect(page.getByLabel("Guest link")).toHaveValue(`${origin}/w/${input.slug}`);
  const visitor = await browser.newContext({ baseURL: origin });
  try {
    const guest = await visitor.newPage();
    await guest.setViewportSize({ width: testInfo.project.name.startsWith("mobile") ? 390 : 1280, height: 900 });
    const projection = await (await guest.request.get(`/api/public/wishlists/${input.slug}`)).json();
    const goal = projection.goals.find((item: { title: string }) => item.title === "A quieter trip");
    const body = { goalId: goal.id, recipientSnapshotId: projection.recipientSnapshot.id, amount: "500",
      currency: "INR", token: randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "") };
    const reported = await guest.request.post(`/api/public/wishlists/${input.slug}/reports`, { data: body, headers: { Origin: origin } });
    expect(reported.status()).toBe(200);
    const receipt = await reported.json();
    expect((await page.request.patch(`/api/owner/wishlists/${initial.id}/reports/${receipt.id}`, {
      data: { status: "owner_confirmed", version: 1, reason: "Matched fictional record", acknowledged: true }, headers: { Origin: origin }
    })).status()).toBe(200);
  await reveal(manager.getByRole("button", { name: "Refresh wishlist", exact: true, includeHidden: true }));
    await manager.getByRole("button", { name: "Refresh wishlist", exact: true }).click();
    await expect(manager.getByText("Target: ₹1,200. Confirmed: ₹500.")).toBeVisible();
    await manager.getByRole("button", { name: "Edit A quieter trip", exact: true }).click();
    await expect(manager.getByLabel("Goal title", { exact: true })).toHaveAttribute("readonly", "");
  await reveal(manager.getByLabel("Reason for the change"));
    await manager.getByLabel("Reason for the change").fill("Private target revision reason");
    await manager.getByLabel("Goal target amount").fill("1500");
    await manager.getByLabel("I acknowledge that a target change").check();
    await page.route("**/api/owner/wishlists/*/goals", (route) => route.request().method() === "PATCH" ? route.abort("failed") : route.continue());
    await manager.getByRole("button", { name: "Save goal", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "server could not be reached" })).toBeVisible();
    await expect(manager.getByLabel("Goal target amount")).toHaveValue("1500");
    await expect(manager.getByLabel("Reason for the change")).toHaveValue("Private target revision reason");
    await page.unroute("**/api/owner/wishlists/*/goals");
    await manager.getByRole("button", { name: "Save goal", exact: true }).click();
    await expect(manager.getByText("Target: ₹1,500. Confirmed: ₹500.")).toBeVisible();
  await reveal(manager.getByLabel("Reason for the change"));
    await manager.getByLabel("Reason for the change").fill("Private archive reason");
  await reveal(manager.getByRole("button", { name: "Archive A quieter trip", exact: true, includeHidden: true }));
    await manager.getByRole("button", { name: "Archive A quieter trip", exact: true }).click();
    await expect(manager.getByRole("heading", { name: "A quieter trip (archived)", exact: true })).toBeVisible();
    expect((await guest.request.post(`/api/public/wishlists/${input.slug}/reports`, { data: body, headers: { Origin: origin } })).status()).toBe(200);
    expect((await guest.request.post(`/api/public/wishlists/${input.slug}/reports`, {
      data: { ...body, token: randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "") }, headers: { Origin: origin }
    })).status()).toBe(409);
    await guest.goto(`/w/${input.slug}`);
    const card = guest.getByRole("region", { name: "A quieter trip", exact: true });
    await expect(card.getByText("Given so far: ₹500")).toBeVisible();
    await expect(card.getByText("Reports are unavailable for this archived goal.")).toBeVisible();
    await card.getByText("Target changes (latest 20)", { exact: true }).click();
    await expect(card.getByText(/₹1,200 to ₹1,500/)).toBeVisible();
    expect(await guest.locator("body").innerText()).not.toContain("Private");
    expect((await guest.request.get(`/api/owner/wishlists/${initial.id}/goals`)).status()).toBe(401);
    await manager.getByText("Goal change history (private)", { exact: true }).click();
    await manager.getByRole("button", { name: "Load latest history", exact: true }).click();
    await expect(manager.getByText(/Private target revision reason/)).toBeVisible();
  await reveal(manager.getByLabel("Reason for the change"));
    await manager.getByLabel("Reason for the change").fill("Private restored goal reason");
  await reveal(manager.getByRole("button", { name: "Restore A quieter trip", exact: true, includeHidden: true }));
    await manager.getByRole("button", { name: "Restore A quieter trip", exact: true }).click();
    await expect(manager.getByRole("heading", { name: "A quieter trip", exact: true })).toBeVisible();
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await manager.getByRole("button", { name: "Edit A quieter trip", exact: true }).click();
    await manager.getByLabel("Goal target amount").fill("1600");
  await reveal(manager.getByLabel("Reason for the change"));
    await manager.getByLabel("Reason for the change").fill("Private unsaved goal reason");
    await manager.getByLabel("I acknowledge that a target change").check();
    await page.context().clearCookies();
    await manager.getByRole("button", { name: "Save goal", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "verified account" })).toBeVisible();
    await expect(manager.getByLabel("Goal target amount")).toHaveValue("1600");
    await expect(manager.getByLabel("Reason for the change")).toHaveValue("Private unsaved goal reason");
  } finally { await visitor.close(); }
});

test("signup guides verification and returns to sign in without trapping the customer", async ({ page }, testInfo) => {
  const email = `${randomUUID()}@example.test`;
  await page.goto("/owner");
  await page.getByRole("button", { name: "Create an account", exact: true }).click();
  await page.getByRole("radio", { name: "Bride", exact: true }).check();
  await page.getByLabel("Your display name").fill("Fictional onboarding");
  await page.getByLabel("Account email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  let release = () => {};
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let submissions = 0;
  let signupPayload: Record<string, unknown> = {};
  await page.route("**/api/auth/sign-up/email", async (route) => { submissions++; signupPayload = route.request().postDataJSON(); await pending; await route.continue(); });
  await page.locator("form").evaluate((form) => {
    if (!(form instanceof HTMLFormElement)) throw new Error("Missing signup form.");
    form.requestSubmit(); form.requestSubmit();
  });
  try {
    await expect(page.getByRole("button", { name: "Please wait...", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Forgot password", exact: true })).toBeDisabled();
    await expect(page.getByLabel("Account email")).toBeDisabled();
    expect(submissions).toBe(1);
  } finally { release(); }
  await expect(page.getByRole("status").filter({ hasText: "verification message" })).toBeVisible();
  await page.unroute("**/api/auth/sign-up/email");
  expect(submissions).toBe(1);
  expect(signupPayload).not.toHaveProperty("starterRole");
  expect(signupPayload).not.toHaveProperty("starter-role");
  await page.screenshot({ path: `test-results/${testInfo.project.name}-signup-next-step.png`, fullPage: true });
  await expect(page.getByRole("heading", { name: "Check your verification message", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue to sign in", exact: true }).click();
  await expect(page.getByLabel("Account email")).toHaveValue(email);
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
  await expect(page.getByRole("status")).toHaveText("");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Check your verification message", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Resend verification message", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("If eligible");
  await page.goto(await verificationLink(email));
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("verified email");
  await page.getByLabel("Account email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Show password", exact: true }).click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide password", exact: true }).click();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Create a wishlist", exact: true })).toBeVisible();
});

test("expired preview returns after sign-in and intentional sign-out clears unsaved details", async ({ page }) => {
  const email = await account(page.request);
  const input = fixture();
  const created = await (await page.request.post("/api/owner/wishlists", { data: input, headers: { Origin: origin } })).json();
  await page.request.post("/api/auth/sign-out", { data: {}, headers: { Origin: origin } });
  await page.goto(`/owner/${created.id}`);
  await page.getByRole("link", { name: "Sign in to your account", exact: true }).click();
  await page.getByLabel("Account email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/owner/${created.id}`);
  await page.getByRole("link", { name: "Back to workspace", exact: true }).click();
  await reveal(page.getByLabel("Couple display names"));
  await page.getByLabel("Couple display names").fill("Private unsaved fictional names");
  let releaseSignOut = () => {};
  const pendingSignOut = new Promise<void>((resolve) => { releaseSignOut = resolve; });
  await page.route("**/owner?*", async (route) => {
    if (route.request().headers().rsc === "1") await pendingSignOut;
    await route.continue();
  });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  try {
    await expect(page.getByRole("status").filter({ hasText: "Signed out. Loading sign-in" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sign in", exact: true })).not.toBeVisible();
  } finally { releaseSignOut(); }
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  await page.unroute("**/owner?*");
  await page.getByLabel("Account email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Couple display names")).toHaveValue("");
  await expect(page.getByRole("link", { name: input.displayNames, exact: true })).toBeVisible();
  await reveal(page.getByLabel("Couple display names"));
  await page.getByLabel("Couple display names").fill("Unsaved details belonging to the first account");
  await page.request.post("/api/auth/sign-out", { data: {}, headers: { Origin: origin } });
  await account(page.request);
  await page.getByRole("button", { name: "Refresh saved wishlists", exact: true }).click();
  await expect(page.getByLabel("Couple display names")).toHaveValue("");
  await expect(page.getByRole("link", { name: input.displayNames, exact: true })).not.toBeVisible();
});

test("password recovery has actionable errors and a verified return to sign in", async ({ page }) => {
  const email = await account(page.request);
  await page.request.post("/api/auth/sign-out", { data: {}, headers: { Origin: origin } });
  await page.goto("/reset-password");
  await page.getByLabel("New password").fill(`${password}-updated`);
  await page.getByRole("button", { name: "Update password", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "missing or invalid" })).toBeVisible();
  await page.getByRole("link", { name: "Request a new recovery link", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Recover account", exact: true })).toBeVisible();
  await page.getByLabel("Account email").fill(email);
  await page.getByRole("button", { name: "Request recovery link", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("If an eligible account exists");
  await page.goto(await mailboxLink(email, "recovery"));
  await page.getByLabel("New password").fill(`${password}-updated`);
  await page.getByRole("button", { name: "Update password", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Password updated");
  expect(page.url()).not.toContain("token");
  await page.getByRole("link", { name: "Return to sign in", exact: true }).click();
  await page.getByLabel("Account email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(`${password}-updated`);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Create a wishlist", exact: true })).toBeVisible();
});

test("saved review survives a failed refresh and irreversible actions require confirmation", async ({ page }) => {
  await account(page.request);
  const input = fixture();
  const created = await (await page.request.post("/api/owner/wishlists", { data: input, headers: { Origin: origin } })).json();
  expect((await page.request.patch(`/api/owner/wishlists/${created.id}`, {
    data: { state: "published", version: created.version }, headers: { Origin: origin }
  })).status()).toBe(200);
  const projection = await (await page.request.get(`/api/public/wishlists/${input.slug}`)).json();
  expect((await page.request.post(`/api/public/wishlists/${input.slug}/reports`, {
    data: { goalId: projection.goals[0].id, recipientSnapshotId: projection.recipientSnapshot.id, amount: "500",
      currency: "INR", token: randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "") }, headers: { Origin: origin }
  })).status()).toBe(200);
  await page.goto(`/owner/${created.id}`);
  const reports = page.getByRole("region", { name: "Gifts from guests", exact: true });
  await page.route(/\/api\/owner\/wishlists\/[^/]+\/reports\?/, (route) => route.abort("failed"));
  if (!(await reports.getByLabel("Note for your records").isVisible())) await reports.getByRole("button", { name: "Review gift", exact: true }).first().click();
  await reports.getByLabel("Note for your records").fill("Matched a fictional record");
  await reports.getByLabel("I have checked this against my own bank").check();
  await reports.getByRole("button", { name: "Confirm gift", exact: true }).click();
  await expect(reports.getByRole("alert")).toContainText("The review was saved, but reports could not refresh");
  await expect(reports.getByLabel("I have checked this against my own bank")).not.toBeChecked();
  await page.unroute(/\/api\/owner\/wishlists\/[^/]+\/reports\?/);
  await reports.getByRole("button", { name: "Refresh", exact: true }).click();
  if (!(await reports.getByLabel("Note for your records").isVisible())) await reports.getByRole("button", { name: "Review gift", exact: true }).first().click();
  await reports.getByLabel("Note for your records").fill("Correcting a fictional mistake");
  await reports.getByRole("button", { name: "Undo confirmation", exact: true }).click();
  const reverse = page.getByRole("dialog", { name: "Reverse this confirmation?", exact: true });
  await expect(reverse).toBeVisible();
  await reverse.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(reverse).not.toBeVisible();
  await expect(reports.getByRole("button", { name: "Undo confirmation", exact: true })).toBeFocused();
  await reports.getByRole("button", { name: "Undo confirmation", exact: true }).click();
  await reverse.getByRole("button", { name: "Reverse confirmation", exact: true }).click();
  await reveal(page.getByText("Given so far: ₹0"));
  await expect(async () => { await reveal(page.getByText("Given so far: ₹0")); await expect(page.getByText("Given so far: ₹0")).toBeVisible(); }).toPass();
  await reveal(page.getByRole("button", { name: "Close wishlist", exact: true, includeHidden: true }));
  await page.getByRole("button", { name: "Close wishlist", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Close this wishlist?", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Status: published")).toBeVisible();
  await reveal(page.getByRole("button", { name: "Close wishlist", exact: true, includeHidden: true }));
  await page.getByRole("button", { name: "Close wishlist", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Close wishlist permanently", exact: true }).click();
  await expect(page.getByText("Status: closed")).toBeVisible();
  await page.getByRole("button", { name: "Archive wishlist", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Archive wishlist permanently", exact: true }).click();
  await expect(page.getByText("Status: archived")).toBeVisible();
  expect((await page.request.get(`/api/public/wishlists/${input.slug}`)).status()).toBe(404);
});

test("a delayed older response cannot roll back newly confirmed report progress", async ({ page }) => {
  await account(page.request);
  const input = fixture();
  const created = await (await page.request.post("/api/owner/wishlists", { data: input, headers: { Origin: origin } })).json();
  await page.request.patch(`/api/owner/wishlists/${created.id}`, {
    data: { state: "published", version: created.version }, headers: { Origin: origin }
  });
  const projection = await (await page.request.get(`/api/public/wishlists/${input.slug}`)).json();
  const entry = await (await page.request.post(`/api/public/wishlists/${input.slug}/reports`, {
    data: { goalId: projection.goals[0].id, recipientSnapshotId: projection.recipientSnapshot.id, amount: "500",
      currency: "INR", token: randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "") }, headers: { Origin: origin }
  })).json();
  const older = await (await page.request.get(`/api/owner/wishlists/${created.id}/reports`)).json();
  await page.goto(`/owner/${created.id}`);
  let release = () => {};
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route(/\/api\/owner\/wishlists\/[^/]+\/reports\?/, async (route) => {
    await pending; await route.fulfill({ json: older });
  });
  try {
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    expect((await page.request.patch(`/api/owner/wishlists/${created.id}/reports/${entry.id}`, {
      data: { status: "owner_confirmed", version: 1, reason: "Concurrent fictional check", acknowledged: true }, headers: { Origin: origin }
    })).status()).toBe(200);
  await reveal(page.getByRole("button", { name: "Refresh wishlist", exact: true, includeHidden: true }));
    await page.getByRole("button", { name: "Refresh wishlist", exact: true }).click();
  await reveal(page.getByText("Given so far: ₹500"));
  await expect(async () => { await reveal(page.getByText("Given so far: ₹500")); await expect(page.getByText("Given so far: ₹500")).toBeVisible(); }).toPass();
    release();
    await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Confirm gift", exact: true })).not.toBeVisible();
  if (!(await page.getByLabel("Note for your records").isVisible())) await page.getByRole("button", { name: "Review gift", exact: true }).first().click();
    await page.getByLabel("Note for your records").fill("Private follow-up check");
    await expect(page.getByRole("button", { name: "Undo confirmation", exact: true })).toBeEnabled();
  } finally { release(); }
});

test("sign-out remains available when shared authentication budgets are exhausted", async ({ request }) => {
  const email = await account(request);
  const db = e2eDatabase();
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  const minute = Math.floor(Date.now() / 60_000);
  const buckets = [minute, minute + 1].flatMap((window) => [
    hash(`auth-global:application:${window}`),
    hash(`auth:/api/auth/sign-out:${hash("local")}:${window}`)
  ]);
  const previous = await db.all<{ bucket: string; count: number; expires_at: string }>(
    "SELECT bucket,count,expires_at FROM rate_limits WHERE bucket=ANY($1::text[])", [buckets]);
  try {
    for (const bucket of buckets) await db.run(`INSERT INTO rate_limits VALUES($1,1000,$2)
      ON CONFLICT(bucket) DO UPDATE SET count=1000,expires_at=EXCLUDED.expires_at`, [bucket, Date.now() + 180_000]);
    expect((await request.post("/api/auth/sign-in/email", {
      data: { email, password }, headers: { Origin: origin }
    })).status()).toBe(429);
    expect((await request.post("/api/auth/sign-out", {
      data: {}, headers: { Origin: "https://evil.example" }
    })).status()).toBe(403);
    expect((await request.post("/api/auth/sign-out", { data: {}, headers: { Origin: origin } })).status()).toBe(200);
    expect((await request.get("/api/owner/wishlists")).status()).toBe(401);
  } finally {
    await db.run("DELETE FROM rate_limits WHERE bucket=ANY($1::text[])", [buckets]);
    for (const row of previous) await db.run("INSERT INTO rate_limits VALUES($1,$2,$3)", [row.bucket, row.count, row.expires_at]);
    await db.close();
  }
});

test("task-focused entry forms stay closed until requested and preserve drafts", async ({ page, browser }) => {
  await account(page.request);
  const input = fixture();
  const created = await (await page.request.post("/api/owner/wishlists", { data: input, headers: { Origin: origin } })).json();
  await page.goto(`/owner/${created.id}`);
  const cash = page.locator("#cash-gifts");
  await expect(cash.getByLabel("Amount (₹)")).not.toBeVisible();
  await cash.getByRole("button", { name: "Record cash gift", exact: true }).click();
  await cash.getByLabel("Amount (₹)").fill("2500");
  await cash.getByLabel("From (optional)").fill("Fictional Aunt");
  await cash.getByRole("button", { name: "Cancel cash entry", exact: true }).click();
  await expect(cash.getByLabel("Amount (₹)")).not.toBeVisible();
  await cash.getByRole("button", { name: "Record cash gift", exact: true }).click();
  await expect(cash.getByLabel("Amount (₹)")).toHaveValue("2500");
  await cash.getByRole("button", { name: "Add cash gift", exact: true }).click();
  await expect(cash.getByRole("status")).toContainText("Cash gift added");
  await expect(cash.getByLabel("Amount (₹)")).not.toBeVisible();
  await expect(cash.getByText(/₹2,500/)).toBeVisible();

  // Navigation reveals the right collapsed section, including a direct fragment load.
  await page.getByRole("link", { name: "Manage goals", exact: true }).click();
  await expect(page.getByRole("button", { name: "Add goal", exact: true })).toBeVisible();
  await page.goto(`/owner/${created.id}#guest-preview`);
  await expect(page.getByRole("heading", { name: "Guest page preview", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Publish after preview", exact: true }).click();
  await expect(page.getByText("Status: published")).toBeVisible();
  const visitor = await browser.newContext({ baseURL: origin });
  try {
    const guest = await visitor.newPage();
    await guest.goto(`/w/${input.slug}`);
    await guest.getByRole("button", { name: "Choose a gift", exact: true }).click();
    await expect(guest.getByLabel(/^Your name/)).not.toBeVisible();
    await guest.getByText("Add your wishes for the couple (optional)", { exact: true }).click();
    await guest.getByLabel(/^Your name/).fill("Fictional Guest");
    await expect(guest.getByRole("checkbox", { name: /List my name/ })).not.toBeChecked();
    await guest.getByText("Add your wishes for the couple (optional)", { exact: true }).click();
    await guest.getByRole("button", { name: "Continue", exact: true }).click();
    await guest.getByRole("button", { name: "Edit details", exact: true }).click();
    await guest.getByText("Add your wishes for the couple (optional)", { exact: true }).click();
    await expect(guest.getByLabel(/^Your name/)).toHaveValue("Fictional Guest");
    for (const width of [320, 390, 768, 1280]) {
      await guest.setViewportSize({ width, height: 900 });
      expect(await guest.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  } finally { await visitor.close(); }
  await page.getByRole("link", { name: "Back to workspace", exact: true }).click();
  await expect(page.getByRole("link", { name: input.displayNames, exact: true })).toBeVisible();
  await expect(page.getByLabel("Couple display names")).not.toBeVisible();
  await page.getByText("Create a wishlist", { exact: true }).click();
  await expect(page.getByLabel("Couple display names")).toBeVisible();
});

test("wedding motion is decorative, finite and respects reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const petals = page.locator(".invitation-petals");
  await expect(petals).toHaveAttribute("aria-hidden", "true");
  await expect(petals).toHaveCSS("pointer-events", "none");
  await expect(petals.locator(".wedding-petal")).toHaveCount(8);
  await expect(page.getByRole("link", { name: "Create your wishlist", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.waitForTimeout(4700);
  expect(await page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === "running").length)).toBe(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect(petals.locator(".wedding-petal").first()).toBeHidden();
  await expect(page.locator(".wedding-teddies")).toHaveCount(0);
  await expect(page.locator(".ring-first")).toHaveCSS("animation-name", "none");
  await expect(page.locator("h1")).toHaveCSS("animation-name", "none");
  await page.getByRole("link", { name: "Create your wishlist", exact: true }).click();
  await expect(page.getByLabel("Account email")).toBeVisible();
});

test("RSVP heart and saved-check motion never changes the guest answer", async ({ page }) => {
  await account(page.request);
  const created = await (await page.request.post("/api/owner/wishlists", { data: fixture(), headers: { Origin: origin } })).json();
  await page.request.patch(`/api/owner/wishlists/${created.id}`, { data: { state: "published", version: created.version }, headers: { Origin: origin } });
  const guest = await (await page.request.post(`/api/owner/wishlists/${created.id}/guests`, {
    data: { name: "Fictional guest" }, headers: { Origin: origin }
  })).json();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(guest.invitePath);
  await page.getByRole("button", { name: "Yes, I'll be there", exact: true }).click();
  await expect(page.locator(".rsvp-heart")).toHaveAttribute("aria-hidden", "true");
  await page.getByLabel("When do you expect to arrive?").fill("18:30");
  await page.getByRole("button", { name: "Save my answer", exact: true }).click();
  await expect(page.locator(".rsvp-saved")).toContainText("Guest details updated");
  await expect(page.locator(".saved-check")).toHaveAttribute("aria-hidden", "true");
  await page.waitForTimeout(4700);
  expect(await page.evaluate(() => document.getAnimations().some((animation) => animation.playState === "running"))).toBe(false);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect(page.getByLabel("When do you expect to arrive?")).toHaveValue("18:30");
  await expect(page.locator(".rsvp-heart")).toHaveCSS("animation-name", "none");
  await page.getByLabel("When do you expect to arrive?").fill("19:00");
  await page.getByRole("button", { name: "Save my answer", exact: true }).click();
  await expect(page.locator(".saved-check polyline")).toHaveCSS("animation-name", "none");
});


test("either partner starts with an accessible role choice", async ({ page }) => {
  await page.goto("/owner?mode=sign-up");
  const bride = page.getByRole("radio", { name: "Bride", exact: true });
  const groom = page.getByRole("radio", { name: "Groom", exact: true });
  await expect(bride).not.toBeChecked();
  await expect(groom).not.toBeChecked();
  await groom.focus();
  await page.keyboard.press("Space");
  await expect(groom).toBeChecked();
  await page.keyboard.press("ArrowLeft");
  await expect(bride).toBeChecked();
  await expect(groom).not.toBeChecked();
  await expect(page.getByText("Preview choice only, not saved.", { exact: false })).toBeVisible();
});


test("credential endpoint budgets normalize email and do not trap sign-out", async ({ request }) => {
  const email = `${randomUUID()}@example.test`;
  const db = e2eDatabase();
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  const window = Math.floor(Date.now() / 60_000);
  const buckets = [window, window + 1].map((minute) => hash(`auth:/api/auth/sign-in/email:${hash(email)}:${minute}`));
  try {
    for (const bucket of buckets) await db.run("INSERT INTO rate_limits VALUES($1,8,$2)", [bucket, Date.now() + 120_000]);
    const response = await request.post("/api/auth/sign-in/email", {
      data: { email: `  ${email.toUpperCase()}  `, password }, headers: { Origin: origin }
    });
    expect(response.status()).toBe(429);
    expect(response.headers()["retry-after"]).toBe("60");
    expect((await request.post("/api/auth/sign-out", { data: {}, headers: { Origin: origin } })).status()).toBe(200);
  } finally {
    await db.run("DELETE FROM rate_limits WHERE bucket=ANY($1::text[])", [buckets]);
    await db.close();
  }
});
