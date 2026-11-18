import { NextResponse, type NextRequest } from "next/server";
import { applicationConfig } from "./server/config";

export function proxy(request: NextRequest) {
  let origin: string;
  try {
    origin = applicationConfig().origin;
  } catch {
    return new NextResponse("Application configuration is unavailable.", { status: 503 });
  }
  if (request.headers.get("host") !== new URL(origin).host) {
    return new NextResponse("Host is not allowed.", { status: 403 });
  }
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
