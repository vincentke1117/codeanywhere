# Security Hardening & Cloudflare Tunnel Implementation Plan

> **For Claude:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden login security (rate limiting, security headers, redirect fix) and add Docker reverse proxy with Cloudflare Tunnel for secure remote access.

**Architecture:** Two independent changes: (1) Application-layer security hardening in Next.js middleware and config. (2) New `docker-compose.tunnel.yml` with Nginx reverse proxy and cloudflared sidecar for remote HTTPS access.

**Tech Stack:** Next.js middleware, Nginx, cloudflared, Docker Compose

**Spec:** `docs/superpowers/specs/2026-02-21-security-and-tunnel-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/rate-limit.ts` | Create | In-memory sliding-window rate limiter |
| `src/middleware.ts` | Modify | Integrate rate limiting into request pipeline |
| `next.config.ts` | Modify | Add security HTTP headers |
| `src/app/login/page.tsx` | Modify | Fix open redirect vulnerability |
| `nginx/nginx.conf` | Create | Reverse proxy with SSE support and rate limiting |
| `docker-compose.tunnel.yml` | Create | Three-service orchestration (app + nginx + cloudflared) |
| `.env.example` | Modify | Add `CLOUDFLARE_TUNNEL_TOKEN` |
| `README.md` | Modify | Add remote access / tunnel deployment section |
| `README_CN.md` | Modify | Same updates in Chinese |
| `README_JA.md` | Modify | Same updates in Japanese |

---

## Chunk 1: Application Security Hardening

### Task 1: Create rate limiter module

**Files:**
- Create: `src/lib/rate-limit.ts`

- [ ] **Step 1: Create the rate limiter module**

Create `src/lib/rate-limit.ts` with an in-memory sliding-window rate limiter:

```typescript
// src/lib/rate-limit.ts

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Clean up expired entries every 60 seconds
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now > entry.resetAt) store.delete(key);
    }
  }, 60_000);
}

/**
 * Check if a request should be rate-limited.
 * @param key - Unique key (e.g., IP address or IP+path)
 * @param limit - Max requests allowed in the window
 * @param windowMs - Window duration in milliseconds
 * @returns Object with `limited` boolean and `remaining` count
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): { limited: boolean; remaining: number } {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { limited: false, remaining: limit - 1 };
  }

  entry.count += 1;
  if (entry.count > limit) {
    return { limited: true, remaining: 0 };
  }

  return { limited: false, remaining: limit - entry.count };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/rate-limit.ts
git commit -m "feat(security): add in-memory rate limiter module"
```

---

### Task 2: Integrate rate limiting into middleware

**Files:**
- Modify: `src/middleware.ts`

The middleware currently handles auth checks. Add rate limiting before auth logic. The rate limiter runs **before** auth checks so that brute-force token guessing is blocked regardless of token validity.

- [ ] **Step 1: Add rate limiting to middleware**

Edit `src/middleware.ts`. Add the import at line 3, and insert rate-limiting logic after the static asset skip (after line 21, before the auth check). The full updated file:

```typescript
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

  // Check Authorization header
  const authorization = request.headers.get("Authorization");
  if (authorization) {
    const [scheme, token] = authorization.split(" ");
    if (scheme === "Bearer" && token === authToken) {
      return NextResponse.next();
    }
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
```

- [ ] **Step 2: Verify build passes**

Run: `npm run build`
Expected: Build succeeds without errors.

- [ ] **Step 3: Commit**

```bash
git add src/middleware.ts
git commit -m "feat(security): add rate limiting to auth middleware"
```

---

### Task 3: Add security HTTP headers

**Files:**
- Modify: `next.config.ts`

- [ ] **Step 1: Add security headers to Next.js config**

Edit `next.config.ts` to add a `headers()` function in the config object. The full updated file:

```typescript
import type { NextConfig } from "next";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pkg = require("./package.json");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-XSS-Protection", value: "1; mode=block" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:;",
  },
];

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['better-sqlite3'],
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
```

- [ ] **Step 2: Verify build passes**

Run: `npm run build`
Expected: Build succeeds. Security headers will be included in all responses.

- [ ] **Step 3: Commit**

```bash
git add next.config.ts
git commit -m "feat(security): add security HTTP headers via Next.js config"
```

---

### Task 4: Fix open redirect vulnerability

**Files:**
- Modify: `src/app/login/page.tsx`

- [ ] **Step 1: Add redirect validation**

In `src/app/login/page.tsx`, find lines 28-29 inside the `handleSubmit` function:

```typescript
        const redirect = searchParams.get("redirect") || "/";
        router.push(redirect);
```

Replace with:

```typescript
        const redirect = searchParams.get("redirect") || "/";
        const safeRedirect = redirect.startsWith("/") && !redirect.startsWith("//") ? redirect : "/";
        router.push(safeRedirect);
```

This ensures only relative paths starting with a single `/` are allowed. Values like `//evil.com` or `https://evil.com` are rejected and default to `/`.

- [ ] **Step 2: Verify build passes**

Run: `npm run build`
Expected: Build succeeds without errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/login/page.tsx
git commit -m "fix(security): prevent open redirect on login page"
```

---

## Chunk 2: Docker Reverse Proxy & Cloudflare Tunnel

### Task 5: Create Nginx configuration

**Files:**
- Create: `nginx/nginx.conf`

- [ ] **Step 1: Create the nginx directory and config**

Create `nginx/nginx.conf`. Note: the SSE streaming endpoint is `POST /api/chat` (not `/api/chat/stream`). This location block must appear **before** the general `/api/` block so Nginx matches it first.

```nginx
events {
    worker_connections 1024;
}

http {
    # Rate limiting zones
    limit_req_zone $binary_remote_addr zone=login:10m rate=5r/m;
    limit_req_zone $binary_remote_addr zone=api:10m rate=30r/m;

    upstream app {
        server codeanywhere:3000;
    }

    server {
        listen 80;
        server_name _;

        # Security headers (supplemental to app-level headers)
        add_header X-Content-Type-Options nosniff always;
        add_header X-Frame-Options DENY always;
        add_header Referrer-Policy strict-origin-when-cross-origin always;

        # Max request body size (file uploads)
        client_max_body_size 50m;

        # --- Login endpoint: strict rate limit ---
        location = /api/health {
            limit_req zone=login burst=3 nodelay;
            proxy_pass http://app;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # --- SSE streaming endpoint: no buffering, long timeout ---
        location = /api/chat {
            proxy_pass http://app;
            proxy_buffering off;
            proxy_cache off;
            proxy_read_timeout 600s;
            proxy_send_timeout 600s;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header Connection '';
            proxy_http_version 1.1;
            chunked_transfer_encoding off;
        }

        # --- General API: moderate rate limit ---
        location /api/ {
            limit_req zone=api burst=20 nodelay;
            proxy_pass http://app;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # --- Static assets and pages ---
        location / {
            proxy_pass http://app;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
        }
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add nginx/nginx.conf
git commit -m "feat(infra): add Nginx reverse proxy config with SSE support"
```

---

### Task 6: Create docker-compose.tunnel.yml

**Files:**
- Create: `docker-compose.tunnel.yml`

- [ ] **Step 1: Create the tunnel compose file**

Create `docker-compose.tunnel.yml`:

```yaml
# docker-compose.tunnel.yml
# Remote access mode: Nginx reverse proxy + Cloudflare Tunnel
# Usage: docker compose -f docker-compose.tunnel.yml up -d
#
# Prerequisites:
#   1. Copy .env.example to .env and fill in values
#   2. Set CLOUDFLARE_TUNNEL_TOKEN in .env
#   3. Configure your Cloudflare Tunnel public hostname to point to http://nginx:80

services:
  codeanywhere:
    build: .
    expose:
      - "3000"
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - AUTH_TOKEN=${AUTH_TOKEN}
    volumes:
      - codeanywhere-data:/root/.codeanywhere
      - claude-config:/root/.claude
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    expose:
      - "80"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - codeanywhere
    restart: unless-stopped

  cloudflared:
    image: cloudflare/cloudflared:latest
    command: tunnel run
    environment:
      - TUNNEL_TOKEN=${CLOUDFLARE_TUNNEL_TOKEN}
    depends_on:
      - nginx
    restart: unless-stopped

volumes:
  codeanywhere-data:
  claude-config:
```

- [ ] **Step 2: Commit**

```bash
git add docker-compose.tunnel.yml
git commit -m "feat(infra): add tunnel compose with Nginx and cloudflared"
```

---

### Task 7: Update .env.example

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add Cloudflare Tunnel token to .env.example**

Replace the full content of `.env.example`:

```bash
# Anthropic API key (required for Claude Code)
ANTHROPIC_API_KEY=your-api-key-here

# Access token to protect your CodeAnywhere instance (optional, recommended when exposed to network)
AUTH_TOKEN=your-secret-access-token

# Cloudflare Tunnel token (only needed for docker-compose.tunnel.yml remote access mode)
# Get your token from: https://one.dash.cloudflare.com/ → Networks → Tunnels
CLOUDFLARE_TUNNEL_TOKEN=your-tunnel-token-here
```

- [ ] **Step 2: Commit**

```bash
git add -f .env.example
git commit -m "feat(infra): add Cloudflare Tunnel token to .env.example"
```

Note: use `git add -f` because `.env*` is in `.gitignore`.

---

### Task 8: Update README files

**Files:**
- Modify: `README.md`
- Modify: `README_CN.md`
- Modify: `README_JA.md`

- [ ] **Step 1: Update the Deploy section in README.md**

In `README.md`, find the existing Deploy section. After the existing Docker and Standalone Node.js subsections, add a new **Remote Access (Cloudflare Tunnel)** subsection:

```markdown
### Remote Access (Cloudflare Tunnel)

To access CodeAnywhere from outside your local network:

1. Create a [Cloudflare](https://dash.cloudflare.com/) account and add a domain.
2. Go to [Zero Trust](https://one.dash.cloudflare.com/) → Networks → Tunnels → Create a tunnel.
3. Copy the Tunnel Token and set the public hostname to point to `http://nginx:80`.
4. Configure your `.env`:

```bash
cp .env.example .env
# Fill in ANTHROPIC_API_KEY, AUTH_TOKEN, CLOUDFLARE_TUNNEL_TOKEN
```

5. Start with the tunnel compose file:

```bash
docker compose -f docker-compose.tunnel.yml up -d
```

Your instance will be available at your configured Cloudflare domain with automatic HTTPS.
```

Also add a brief note about security headers in the Features list:

```markdown
- **Security headers** -- CSP, X-Frame-Options, and other security headers are set automatically.
```

- [ ] **Step 2: Apply the same changes to README_CN.md and README_JA.md**

Translate the Remote Access section and the security headers feature line into Chinese and Japanese respectively. Follow the existing translation style in each file.

- [ ] **Step 3: Commit**

```bash
git add README.md README_CN.md README_JA.md
git commit -m "docs: add remote access via Cloudflare Tunnel to READMEs"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Rate limiter module | `src/lib/rate-limit.ts` |
| 2 | Integrate rate limiting into middleware | `src/middleware.ts` |
| 3 | Add security HTTP headers | `next.config.ts` |
| 4 | Fix open redirect | `src/app/login/page.tsx` |
| 5 | Nginx reverse proxy config | `nginx/nginx.conf` |
| 6 | Tunnel compose file | `docker-compose.tunnel.yml` |
| 7 | Update .env.example | `.env.example` |
| 8 | Update README files | `README.md`, `README_CN.md`, `README_JA.md` |

Total: 8 tasks, 2 chunks. Chunk 1 (Tasks 1-4) is application security. Chunk 2 (Tasks 5-8) is infrastructure.
