import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { openDatabase } from "../../src/server/database";

const origin = "http://127.0.0.1:4318";
const password = "Fictional-test-only-password!42";

function e2eDatabase() {
  const name = process.env.E2E_DB_NAME;
  if (!name || !/^wishlist_e2e_[a-f0-9]{32}$/.test(name)) throw new Error("Missing isolated E2E database name.");
  const adminUrl = process.env.WISHLIST_TEST_ADMIN_URL ||
    (JSON.parse(readFileSync(resolve("data", "local-postgres.json"), "utf8")) as { adminUrl: string }).adminUrl;
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return openDatabase(url.toString());
}
async function verificationLink(email: string): Promise<string> {
  const db = e2eDatabase();
  try {
    const entry = await db.get("SELECT url FROM auth_local_outbox WHERE recipient=$1 AND kind='verification' ORDER BY created_at DESC LIMIT 1", [email]);
    if (!entry) throw new Error("No synthetic authentication message was queued.");
    return String(entry.url);
  } finally { await db.close(); }
}
function inviteToken(href: string): string {
  const text = decodeURIComponent(new URL(href).searchParams.get("text") ?? "");
  const match = text.match(/\/rsvp\/([A-Za-z0-9_-]{32})/);
  if (!match) throw new Error("Invite link missing from share text.");
  return match[1];
}

test("guest list, private RSVP links, arrival times and host counts", async ({ page, browser }, testInfo) => {
  await page.goto("/owner");
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
  await page.getByLabel("Couple display names").fill("Priya & Kiran");
  const slug = `guests-${randomUUID()}`;
  await page.getByLabel("Share slug").fill(slug);
  await page.getByLabel("Goal title", { exact: true }).fill("Home deposit");
  await page.getByLabel("Target amount").fill("500000");
  await page.getByRole("button", { name: "Save draft and preview" }).click();
  await expect(page.getByText("Status: draft")).toBeVisible();
  await page.getByRole("button", { name: "Publish after preview" }).click();
  await expect(page.getByLabel("Guest link")).toHaveValue(`${origin}/w/${slug}`);

  const section = page.locator("#guest-list");
  const counts = section.locator(".counts-line");
  await expect(section.getByRole("heading", { name: "Guest list and RSVP" })).toBeVisible();
  await expect(counts).toContainText("0 invited");
  // The add form opens from a single entry point instead of sitting open.
  await expect(section.getByLabel("Guest name")).toHaveCount(0);
  await section.getByRole("button", { name: "Add guest", exact: true }).click();
  for (const name of ["Aunt Meena", "Ravi Kumar", "Sana Sheikh"]) {
    await section.getByLabel("Guest name").fill(name);
    await section.getByRole("button", { name: "Add", exact: true }).click();
    await expect(section.getByText(name, { exact: true })).toBeVisible();
  }
  await expect(counts).toContainText("3 invited");
  await expect(counts).toContainText("3 awaiting");

  // Bulk add hides behind a toggle; existing names are skipped and the raw links never
  // hit the page - sharing happens per guest, with a Copy-all kept in the notice.
  await section.getByRole("button", { name: "Add many guests" }).click();
  await section.getByLabel(/Add many guests/).fill("Divya N\nOmar Farooq\nRavi Kumar");
  await section.getByRole("button", { name: "Add all" }).click();
  await expect(section.getByText(/2 guests added/)).toBeVisible();
  await expect(section.getByText(/Skipped, already on the list: Ravi Kumar/)).toBeVisible();
  await expect(section.getByRole("button", { name: "Copy all invite links" })).toBeVisible();
  await expect(section.locator("#bulk-links")).toHaveCount(0);
  await expect(counts).toContainText("5 invited");
  // The bulk notice is one compact dismissible message.
  await section.getByRole("button", { name: "Dismiss" }).click();
  await expect(section.getByText(/2 guests added/)).toHaveCount(0);
  // Rows show only the share action up front; copy, reminder and remove sit under More.
  const divyaRow = section.locator("li", { hasText: "Divya N" });
  await expect(divyaRow.getByRole("button", { name: "Copy reminder" })).toHaveCount(0);
  await divyaRow.getByRole("button", { name: "More actions for Divya N" }).click();
  await expect(divyaRow.getByRole("button", { name: "Copy private link" })).toBeVisible();
  await expect(divyaRow.getByRole("button", { name: "Copy reminder" })).toBeVisible();
  await divyaRow.getByRole("button", { name: "More actions for Divya N" }).click();
  await expect(divyaRow.getByRole("button", { name: "Copy private link" })).toHaveCount(0);

  const shares = section.getByRole("link", { name: /Share on WhatsApp/ });
  const tokens: string[] = [];
  for (const index of [0, 1]) tokens.push(inviteToken(await shares.nth(index).getAttribute("href") ?? ""));

  const visitor = await browser.newContext({ baseURL: origin });
  const guest = await visitor.newPage();
  const rsvpResponse = await guest.goto(`/rsvp/${tokens[0]}`);
  // Token-bearing pages must not be cached, indexed or leak the link through referrers.
  expect(rsvpResponse?.headers()["cache-control"]).toContain("no-store");
  expect(rsvpResponse?.headers()["x-robots-tag"]).toContain("noindex");
  expect(rsvpResponse?.headers()["referrer-policy"]).toBe("no-referrer");
  await expect(guest.getByRole("heading", { name: "Priya & Kiran" })).toBeVisible();
  await expect(guest.getByText(/Hello Aunt Meena/)).toBeVisible();
  await guest.screenshot({ path: `/downloads/rsvp-guest-page-${testInfo.project.name}.png`, fullPage: true });
  await guest.getByRole("button", { name: "Yes, I'll be there" }).click();
  await guest.getByLabel(/When do you expect to arrive/).fill("19:00");
  await guest.screenshot({ path: `/downloads/rsvp-arrival-edit-${testInfo.project.name}.png`, fullPage: true });
  await guest.getByRole("button", { name: "Save my answer" }).click();
  await expect(guest.getByText(/Guest details updated/)).toBeVisible();
  await expect(guest.getByText(/7:00 pm/i)).toBeVisible();

  await guest.goto(`/rsvp/${tokens[1]}`);
  await guest.getByRole("button", { name: "No, I can't make it" }).click();
  await guest.getByRole("button", { name: "Save my answer" }).click();
  await expect(guest.getByText(/Guest details updated/)).toBeVisible();

  // Unknown tokens and removed guests get the same 404, and the API is origin-guarded.
  expect((await guest.request.get("/api/rsvp/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).status()).toBe(404);
  expect((await guest.request.post(`/api/rsvp/${tokens[1]}`, { data: { rsvp: "attending", expectedArrival: "20:00" },
    headers: { Origin: "https://evil.example" } })).status()).toBe(403);

  // Guests cannot see other guests, gifts or owner data through the link.
  await expect(guest.getByText("Aunt Meena")).toHaveCount(0);
  expect((await guest.request.get(`/api/rsvp/${tokens[1]}`)).status()).toBe(200);
  expect((await guest.request.get("/api/owner/wishlists")).status()).toBe(401);

  await page.reload();
  const updated = page.locator("#guest-list");
  const updatedCounts = updated.locator(".counts-line");
  await expect(updatedCounts).toContainText("1 confirmed");
  await expect(updatedCounts).toContainText("1 not attending");
  await expect(updatedCounts).toContainText("3 awaiting");
  await expect(updated.getByText(/arriving around 7:00 pm/i)).toBeVisible();
  await updated.screenshot({ path: `/downloads/owner-guest-dashboard-${testInfo.project.name}.png` });

  // Removed guests' links stop working; reset links restore sharing without losing answers.
  const meenaRow = updated.locator("li", { hasText: "Aunt Meena" });
  await meenaRow.getByRole("button", { name: "Reset link" }).click();
  await expect(updated.getByText(/New private link created/)).toBeVisible();
  const newToken = inviteToken(await updated.locator("li", { hasText: "Aunt Meena" }).getByRole("link", { name: "Share on WhatsApp" }).getAttribute("href") ?? "");
  expect(newToken).not.toBe(tokens[0]);
  await guest.goto(`/rsvp/${newToken}`);
  await expect(guest.getByText(/Hello Aunt Meena/)).toBeVisible();
  page.once("dialog", (dialog) => void dialog.accept());
  const sanaRow = updated.locator("li", { hasText: "Sana Sheikh" });
  await sanaRow.getByRole("button", { name: "More actions for Sana Sheikh" }).click();
  await sanaRow.getByRole("button", { name: "Remove" }).click();
  await expect(updated.getByText(/Guest removed/)).toBeVisible();
  await expect(updatedCounts).toContainText("4 invited");

  // A newly saved recipient version shows under Saved versions without a page reload.
  const payment = page.locator("#payment-setup");
  await payment.getByLabel("Your UPI ID").fill("fictional.couple@upi");
  await payment.getByLabel("Name guests will see").fill("Priya & Kiran");
  await payment.getByRole("button", { name: "Save", exact: true }).click();
  await expect(payment.getByText("Saved versions")).toBeVisible();
  await payment.getByText("Saved versions", { exact: true }).click();
  await expect(payment.getByText(/fictional\.couple@upi/)).toBeVisible();
});

test("owner records a phone reply with audit, stale protection and guest override", async ({ page, browser }) => {
  await page.goto("/owner?mode=sign-up");
  await page.getByRole("radio", { name: "Groom", exact: true }).check();
  const email = `${randomUUID()}@example.test`;
  await page.getByLabel("Your display name").fill("Fictional owner");
  await page.getByLabel("Account email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Check your verification message", exact: true })).toBeVisible();
  await page.goto(await verificationLink(email));
  await page.getByLabel("Account email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Couple display names")).toBeVisible();
  const created = await (await page.request.post("/api/owner/wishlists", { headers: { Origin: origin }, data: {
    displayNames: "Fictional couple", slug: `phone-${randomUUID()}`, visibility: "unlisted", goals: [{ title: "Our dream", target: "1000" }]
  } })).json();
  await page.request.patch(`/api/owner/wishlists/${created.id}`, { headers: { Origin: origin }, data: { state: "published", version: created.version } });
  const added = await (await page.request.post(`/api/owner/wishlists/${created.id}/guests`, { headers: { Origin: origin }, data: { name: "Aunt Meena" } })).json();
  const guestId = added.guests[0].id;
  const route = `/api/owner/wishlists/${created.id}/guests/${guestId}`;
  const visitor = await browser.newContext({ baseURL: origin });
  try {
    expect((await visitor.request.patch(route, { headers: { Origin: origin }, data: {} })).status()).toBe(401);
    expect((await page.request.patch(route, { headers: { Origin: "https://other.example" }, data: {} })).status()).toBe(403);
    await page.goto(`/owner/${created.id}#guest-list`);
    const section = page.locator("#guest-list");
    await expect(section.getByRole("button", { name: "Record phone reply", exact: true })).toHaveCount(0);
    await section.getByRole("button", { name: "More actions for Aunt Meena", exact: true }).click();
    await section.getByRole("button", { name: "Record phone reply", exact: true }).click();
    const form = section.getByRole("form", { name: "Record answer for Aunt Meena", exact: true });
    await expect(form.getByLabel("Guest's answer", { exact: true })).toBeFocused();
    await form.getByLabel("Guest's answer", { exact: true }).selectOption("attending");
    await form.getByLabel("Expected arrival (optional)").fill("18:30");
    await form.getByLabel("Source note").fill("Phone call with guest");
    await form.getByRole("button", { name: "Save guest answer", exact: true }).click();
    await expect(section.getByText("Answer saved by you.", { exact: false })).toBeVisible();
    await expect(section.locator(".counts-line")).toContainText("1 confirmed");
    expect((await page.request.patch(route, { headers: { Origin: origin }, data: { rsvp: "not_attending", previousUpdatedAt: null, reason: "Stale tab" } })).status()).toBe(409);
    const guest = await visitor.newPage();
    await guest.goto(added.invitePath);
    await expect(guest.getByLabel("When do you expect to arrive?")).toHaveValue("18:30");
    await guest.getByRole("button", { name: "No, I can't make it", exact: true }).click();
    await guest.getByRole("button", { name: "Save my answer", exact: true }).click();
    await expect(guest.getByRole("status")).toContainText("Guest details updated");
    await section.getByRole("button", { name: "Refresh guest list", exact: true }).click();
    await expect(section.locator(".counts-line")).toContainText("1 not attending");
    const db = e2eDatabase();
    try {
      const audit = await db.get<{event:string;to_state:string}>("SELECT event,to_state FROM audit_entries WHERE wishlist_id=$1 AND event='host_rsvp_recorded'", [created.id]);
      expect(JSON.parse(audit!.to_state).source).toBe("Phone call with guest");
    } finally { await db.close(); }
  } finally { await visitor.close(); }
});
