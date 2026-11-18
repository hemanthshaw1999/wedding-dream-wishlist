import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const origin = process.env.APP_ORIGIN;
  if (process.env.DEMO_MODE !== "local-only" || !origin) {
    return new NextResponse("Local demo is disabled.", { status: 503 });
  }
  if (request.headers.get("host") !== new URL(origin).host) {
    return new NextResponse("Host is not allowed.", { status: 403 });
  }
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
