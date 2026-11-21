import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AuthPanel } from "../src/components/auth-panel";
vi.mock("../src/components/auth-client", () => ({ authClient: {} }));

describe("production onboarding", () => {
  it("shows only working signup controls, without local-mailbox help or preview-only role choices", () => {
    const html = renderToStaticMarkup(createElement(AuthPanel, { demo: false, entry: "sign-up", onSignedIn: () => {} }));
    expect(html).toContain("Your display name");
    expect(html).toContain("Create account");
    expect(html).not.toContain("starter-role");
    expect(html).not.toContain("Preview choice");
    expect(html).not.toContain("Local mailbox");
    expect(html).not.toContain("auth:mailbox");
  });
  it("keeps the explicitly preview-only role choices confined to local previews", () => {
    const html = renderToStaticMarkup(createElement(AuthPanel, { demo: true, entry: "sign-up", onSignedIn: () => {} }));
    expect(html).toContain("Preview choice only, not saved");
    expect(html).toContain("Local mailbox");
  });
});
