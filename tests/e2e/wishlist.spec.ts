import { expect, test, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { openDatabase } from "../../src/server/database";

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
async function verificationLink(email: string): Promise<string> {
  const db = e2eDatabase();
  try {
    const entry = await db.get("SELECT url FROM auth_local_outbox WHERE recipient=$1 AND kind='verification' ORDER BY created_at DESC LIMIT 1", [email]);
    if (!entry) throw new Error("No synthetic verification message was queued.");
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
  await page.getByLabel("Your display name").fill("Fictional owner");
  await page.getByLabel("Account email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "verification message" })).toBeVisible();
  await page.goto(await verificationLink(email));
  await page.getByLabel("Account email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Couple display names").fill("तारा & Arjun 💛");
  await page.getByLabel("Your story").fill("<script>window.__xss=true</script> Fictional only");
  const slug = `browser-${randomUUID()}`;
  await page.getByLabel("Share slug").fill(slug);
  await page.getByLabel("Goal title", { exact: true }).fill("Our honeymoon");
  await page.getByLabel("Target amount").fill("300000");
  await page.getByRole("button", { name: "Save draft and preview" }).click();
  await expect(page.getByRole("heading", { name: "तारा & Arjun 💛" })).toBeVisible();
  await expect(page.getByText("Current state: draft.")).toBeVisible();
  await page.reload();
  const visitor = await browser.newContext({ baseURL: origin });
  const guest = await visitor.newPage();
  expect((await guest.goto(`/w/${slug}`))?.status()).toBe(404);
  await page.getByRole("button", { name: "Publish after preview" }).click();
  await expect(page.getByLabel("Guest wishlist link")).toHaveValue(`${origin}/w/${slug}`);
  await page.getByRole("button", { name: "Create link QR" }).click();
  await expect(page.getByRole("img", { name: /not a payment QR/ })).toBeVisible();
  await guest.goto(`${origin}/w/${slug}`);
  await expect(guest.getByRole("heading", { name: "तारा & Arjun 💛" })).toBeVisible();
  await expect(guest.getByText("Confirmed progress: ₹0")).toBeVisible();
  expect(await guest.evaluate(() => "__xss" in window)).toBe(false);
  expect(await guest.locator("body").innerText()).toContain("<script>window.__xss=true</script>");
  expect((await guest.request.get("/api/owner/wishlists")).status()).toBe(401);
  const projection = await (await guest.request.get(`/api/public/wishlists/${slug}`)).json();
  expect(projection).not.toHaveProperty("id"); expect(projection).not.toHaveProperty("version");
  const secretCookie = (await page.context().cookies()).find((cookie) => cookie.name.endsWith("session_token"));
  expect(secretCookie?.httpOnly).toBe(true); expect(secretCookie?.sameSite).toBe("Strict");
  expect(await page.getByLabel("Guest wishlist link").inputValue()).not.toContain(secretCookie?.value || "missing");
  await guest.getByRole("button", { name: "Choose a demo gift" }).click();
  await guest.getByLabel("Guest name").fill("=1+1");
  await guest.getByLabel("Message (optional").fill("A private fictional message");
  await guest.getByRole("button", { name: "Review demo gift" }).click();
  await expect(guest.getByRole("img", { name: "Demo instruction QR - not payable and not a UPI QR" })).toBeVisible();
  await guest.getByRole("checkbox").check();
  await guest.getByRole("button", { name: "Submit demo report", exact: true }).click();
  await expect(guest.getByRole("heading", { name: "Report saved - not verified" })).toBeVisible();
  const privateUrl = await guest.getByLabel("Private status link").inputValue();
  expect(new URL(privateUrl).hash.length).toBe(65);
  const replayBody = { goalId: projection.goals[0].id, recipientSnapshotId: projection.recipientSnapshot.id,
    amount: "500", currency: "INR", guestName: "=1+1", guestMessage: "A private fictional message",
    reference: "", token: new URL(privateUrl).hash.slice(1) };
  const retries = await Promise.all([0, 1].map(() => guest.request.post(`/api/public/wishlists/${slug}/reports`, {
    data: replayBody, headers: { Origin: origin }
  })));
  expect(retries.map((response) => response.status())).toEqual([200, 200]);
  expect((await retries[0].json()).id).toBe((await retries[1].json()).id);
  await expect(guest.getByText("Confirmed progress: ₹0")).toBeVisible();
  await page.getByRole("button", { name: "Refresh reports" }).click();
  await expect(page.getByRole("heading", { name: "₹500 - =1+1" })).toBeVisible();
  const ownerId = new URL(page.url()).pathname.split("/").at(-1);
  const pending = await (await page.request.get(`/api/owner/wishlists/${ownerId}/reports`)).json();
  expect(pending.total).toBe(1);
  expect((await page.request.patch(`/api/owner/wishlists/${ownerId}/reports/${pending.claims[0].id}`, {
    data: { status: "owner_confirmed", version: 1, reason: "Missing acknowledgement" }, headers: { Origin: origin }
  })).status()).toBe(422);
  await page.getByLabel("Reason for next review action").fill("Matched fictional bank record in synthetic test");
  await page.getByLabel("I understand confirmation is manual").check();
  await page.getByRole("button", { name: "Confirm demo report" }).click();
  await expect(page.getByText("Confirmed progress: ₹500")).toBeVisible();
  const csv = await page.request.get(`/api/owner/wishlists/${ownerId}/reports/export`);
  expect(csv.status()).toBe(200); expect(await csv.text()).toContain("\"'=1+1\"");
  await page.screenshot({ path: `test-results/${testInfo.project.name}-owner.png`, fullPage: true });
  await guest.goto(privateUrl);
  await guest.getByRole("button", { name: "Check report status" }).click();
  await expect(guest.getByRole("heading", { name: "Owner-confirmed demo report" })).toBeVisible();
  expect(guest.url()).not.toContain("#");
  await guest.goto(`${origin}/w/${slug}`);
  expect(await guest.locator("body").innerText()).not.toContain("A private fictional message");
  await expect(guest.getByText("Confirmed progress: ₹500")).toBeVisible();
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
  await expect(page.getByRole("alert").filter({ hasText: "server could not be reached" })).toBeVisible();
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
  await manager.getByLabel("Reason for goal change").fill("Private initial edit reason");
  await manager.getByRole("button", { name: "Edit Our honeymoon", exact: true }).click();
  await manager.getByLabel("Goal title", { exact: true }).fill("A quieter trip");
  await manager.getByLabel("Goal target amount").fill("1200");
  await manager.getByRole("button", { name: "Save goal", exact: true }).click();
  await expect(manager.getByRole("heading", { name: "A quieter trip", exact: true })).toBeVisible();
  await manager.getByRole("button", { name: "Add goal", exact: true }).click();
  await manager.getByLabel("Reason for goal change").fill("Private added goal reason");
  await manager.getByLabel("Goal title", { exact: true }).fill("Our home");
  await manager.getByLabel("Goal target amount").fill("2000");
  await manager.getByRole("button", { name: "Save goal", exact: true }).click();
  await expect(manager.getByRole("heading", { name: "Our home", exact: true })).toBeVisible();
  await manager.getByLabel("Reason for goal change").fill("Private reordered goals reason");
  await manager.getByRole("button", { name: "Move Our home up", exact: true }).click();
  await expect(manager.locator("ol.report-list").first().locator(":scope > li").first().getByRole("heading")).toHaveText("Our home");
  await page.getByRole("button", { name: "Publish after preview", exact: true }).click();
  await expect(page.getByLabel("Guest wishlist link")).toHaveValue(`${origin}/w/${input.slug}`);
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
    await manager.getByRole("button", { name: "Refresh wishlist", exact: true }).click();
    await expect(manager.getByText("Target: ₹1,200. Confirmed: ₹500.")).toBeVisible();
    await manager.getByRole("button", { name: "Edit A quieter trip", exact: true }).click();
    await expect(manager.getByLabel("Goal title", { exact: true })).toHaveAttribute("readonly", "");
    await manager.getByLabel("Reason for goal change").fill("Private target revision reason");
    await manager.getByLabel("Goal target amount").fill("1500");
    await manager.getByLabel("I acknowledge that a target change").check();
    await page.route("**/api/owner/wishlists/*/goals", (route) => route.request().method() === "PATCH" ? route.abort("failed") : route.continue());
    await manager.getByRole("button", { name: "Save goal", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "server could not be reached" })).toBeVisible();
    await expect(manager.getByLabel("Goal target amount")).toHaveValue("1500");
    await expect(manager.getByLabel("Reason for goal change")).toHaveValue("Private target revision reason");
    await page.unroute("**/api/owner/wishlists/*/goals");
    await manager.getByRole("button", { name: "Save goal", exact: true }).click();
    await expect(manager.getByText("Target: ₹1,500. Confirmed: ₹500.")).toBeVisible();
    await manager.getByLabel("Reason for goal change").fill("Private archive reason");
    await manager.getByRole("button", { name: "Archive A quieter trip", exact: true }).click();
    await expect(manager.getByRole("heading", { name: "A quieter trip (archived)", exact: true })).toBeVisible();
    expect((await guest.request.post(`/api/public/wishlists/${input.slug}/reports`, { data: body, headers: { Origin: origin } })).status()).toBe(200);
    expect((await guest.request.post(`/api/public/wishlists/${input.slug}/reports`, {
      data: { ...body, token: randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "") }, headers: { Origin: origin }
    })).status()).toBe(409);
    await guest.goto(`/w/${input.slug}`);
    const card = guest.getByRole("region", { name: "A quieter trip", exact: true });
    await expect(card.getByText("Confirmed progress: ₹500")).toBeVisible();
    await expect(card.getByText("Demo reports are unavailable for this archived goal.")).toBeVisible();
    await card.getByText("Target changes (latest 20)", { exact: true }).click();
    await expect(card.getByText(/₹1,200 to ₹1,500/)).toBeVisible();
    expect(await guest.locator("body").innerText()).not.toContain("Private");
    expect((await guest.request.get(`/api/owner/wishlists/${initial.id}/goals`)).status()).toBe(401);
    await manager.getByText("Goal change history (private)", { exact: true }).click();
    await manager.getByRole("button", { name: "Load latest history", exact: true }).click();
    await expect(manager.getByText(/Private target revision reason/)).toBeVisible();
    await manager.getByLabel("Reason for goal change").fill("Private restored goal reason");
    await manager.getByRole("button", { name: "Restore A quieter trip", exact: true }).click();
    await expect(manager.getByRole("heading", { name: "A quieter trip", exact: true })).toBeVisible();
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await manager.getByRole("button", { name: "Edit A quieter trip", exact: true }).click();
    await manager.getByLabel("Goal target amount").fill("1600");
    await manager.getByLabel("Reason for goal change").fill("Private unsaved goal reason");
    await manager.getByLabel("I acknowledge that a target change").check();
    await page.context().clearCookies();
    await manager.getByRole("button", { name: "Save goal", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "verified account" })).toBeVisible();
    await expect(manager.getByLabel("Goal target amount")).toHaveValue("1600");
    await expect(manager.getByLabel("Reason for goal change")).toHaveValue("Private unsaved goal reason");
  } finally { await visitor.close(); }
});
