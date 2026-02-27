// src/middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { rateLimit } from "@/lib/rate-limit";

// Rate limit constants
const LOGIN_LIMIT = 5;       // 5 attempts per minute
const LOGIN_WINDOW = 60_000; // 1 minute
const API_LIMIT = 120;       // 120 requests per minute
const API_WINDOW = 60_000;   // 1 minute

export function middleware(request: NextRequest) {
  const authToken = process.env.AUTH_TOKEN;

  // If no AUTH_TOKEN configured, skip auth
  if (!authToken) return NextResponse.next();

  // Skip auth for login page and static assets
  const { pathname } = request.nextUrl;
  if (
    pathname === "/login" ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/icons/") ||
    pathname === "/manifest.json" ||
    pathname === "/sw.js" ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  // --- Rate Limiting ---
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "unknown";

  if (pathname === "/api/health") {
    // Strict limit on login/health verification
    const { limited } = rateLimit(`login:${ip}`, LOGIN_LIMIT, LOGIN_WINDOW);
    if (limited) {
      return NextResponse.json(
        { error: "Too many requests. Try again later." },
        { status: 429 }
      );
    }
  } else if (pathname.startsWith("/api/")) {
    // General API rate limit
    const { limited } = rateLimit(`api:${ip}`, API_LIMIT, API_WINDOW);
    if (limited) {
      return NextResponse.json(
        { error: "Too many requests. Try again later." },
        { status: 429 }
      );
    }
  }

  // Check Authorization header first, then auth cookie fallback for browser page navigations
  const authorization = request.headers.get("Authorization");
  const cookieToken = request.cookies.get("codeanywhere_auth_token")?.value;
  if (authorization) {
    const [scheme, token] = authorization.split(" ");
    if (scheme === "Bearer" && token === authToken) {
      return NextResponse.next();
    }
  }
  if (cookieToken && cookieToken === authToken) {
    return NextResponse.next();
  }

  // For API routes, return 401
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // For page routes, redirect to login
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("redirect", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    // Match all paths except _next/static, _next/image, favicon
    "/((?!_next/static|_next/image).*)",
  ],
};
