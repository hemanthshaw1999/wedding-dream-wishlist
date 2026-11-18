import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { applicationConfig } from "./server/config";

export function proxy(request: NextRequest) {
  let application: ReturnType<typeof applicationConfig>;
  try {
    application = applicationConfig();
  } catch {
    return new NextResponse("Application configuration is unavailable.", { status: 503 });
  }
  if (request.headers.get("host") !== new URL(application.origin).host) {
    return new NextResponse("Host is not allowed.", { status: 403 });
  }
  const nonce = randomBytes(16).toString("base64");
  const development = application.mode === "demo" && process.env.NODE_ENV === "development";
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:", "font-src 'self'",
    `connect-src 'self'${development ? ` ${application.origin.replace("http:", "ws:")}` : ""}`,
    "frame-ancestors 'none'", "form-action 'self'", "base-uri 'none'", "object-src 'none'",
    ...(application.mode === "production" ? ["upgrade-insecure-requests"] : [])
  ].join("; ");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  if (application.mode === "production") response.headers.set("Strict-Transport-Security", "max-age=31536000");
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
