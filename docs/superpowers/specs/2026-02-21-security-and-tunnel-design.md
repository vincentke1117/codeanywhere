# Security Hardening & Cloudflare Tunnel Design

**Date:** 2026-02-21
**Status:** Approved
**Scope:** Single-user self-hosted deployment

---

## Overview

Two improvements to CodeAnywhere's deployment security and accessibility:

1. **Login security hardening** — Rate limiting, security headers, redirect fix
2. **Docker reverse proxy + Cloudflare Tunnel** — Secure remote access via HTTPS

---

## Part 1: Login Security Hardening

### 1.1 Rate Limiting (Middleware Layer)

Add in-memory sliding-window rate limiting to `src/middleware.ts`:

- **Login endpoint** (`/api/health`): 5 requests/minute per IP
- **General API**: 120 requests/minute per IP
- Exceeded requests receive `429 Too Many Requests`
- Implementation: `Map<string, { count: number; resetAt: number }>` with periodic cleanup
- No external dependencies; suitable for single-instance single-user deployment

### 1.2 Security HTTP Headers

Add via `next.config.ts` `headers()` function:

| Header | Value |
|--------|-------|
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `X-XSS-Protection` | `1; mode=block` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:;` |

HSTS is handled by Cloudflare when tunneled; not hardcoded in app layer.

### 1.3 Open Redirect Fix

In `src/app/login/page.tsx`, validate the `redirect` query parameter:

```typescript
const redirect = searchParams.get("redirect") || "/";
const safeRedirect = redirect.startsWith("/") && !redirect.startsWith("//") ? redirect : "/";
router.push(safeRedirect);
```

Rejects any value containing `://` or starting with `//`.

---

## Part 2: Docker Reverse Proxy + Cloudflare Tunnel

### 2.1 Architecture

```
Internet User (HTTPS)
      ↓
Cloudflare CDN (auto HTTPS + DDoS protection)
      ↓
cloudflared container (outbound tunnel connection)
      ↓
Nginx container (reverse proxy + security headers + WebSocket + rate limiting)
      ↓
CodeAnywhere container (Node.js :3000)
```

All three containers communicate over Docker internal network. Only cloudflared makes outbound connections to Cloudflare. **No inbound ports exposed to host.**

### 2.2 Two Compose Files

#### `docker-compose.yml` — Local Development Mode

Single-service setup, port 3000 exposed directly to host:

```yaml
services:
  codeanywhere:
    build: .
    ports:
      - "3000:3000"
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - AUTH_TOKEN=${AUTH_TOKEN}
    volumes:
      - codeanywhere-data:/root/.codeanywhere
      - claude-config:/root/.claude
    restart: unless-stopped

volumes:
  codeanywhere-data:
  claude-config:
```

#### `docker-compose.tunnel.yml` — Remote Access Mode

Three-service setup with Nginx reverse proxy and Cloudflare Tunnel:

```yaml
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

### 2.3 Nginx Configuration

File: `nginx/nginx.conf`

```nginx
events { worker_connections 1024; }

http {
    limit_req_zone $binary_remote_addr zone=api:10m rate=30r/m;
    limit_req_zone $binary_remote_addr zone=login:10m rate=5r/m;

    upstream codeanywhere {
        server codeanywhere:3000;
    }

    server {
        listen 80;

        # Security headers
        add_header X-Content-Type-Options nosniff always;
        add_header X-Frame-Options DENY always;
        add_header Referrer-Policy strict-origin-when-cross-origin always;

        # Login rate limiting
        location = /api/health {
            limit_req zone=login burst=3 nodelay;
            proxy_pass http://codeanywhere;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
        }

        # API rate limiting
        location /api/ {
            limit_req zone=api burst=20 nodelay;
            proxy_pass http://codeanywhere;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
        }

        # SSE streaming — no buffering, long timeout
        location /api/chat/stream {
            proxy_pass http://codeanywhere;
            proxy_buffering off;
            proxy_cache off;
            proxy_read_timeout 300s;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header Connection '';
            proxy_http_version 1.1;
            chunked_transfer_encoding off;
        }

        # Static assets and pages (WebSocket upgrade support)
        location / {
            proxy_pass http://codeanywhere;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
        }
    }
}
```

### 2.4 Cloudflare Tunnel Setup (User Steps)

1. Create a Cloudflare account and add a domain
2. Go to [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) → Networks → Tunnels
3. Create a new tunnel, copy the Tunnel Token
4. Configure Public Hostname: subdomain → `http://nginx:80`
5. Add `CLOUDFLARE_TUNNEL_TOKEN=<token>` to `.env`
6. Run `docker compose -f docker-compose.tunnel.yml up -d`

### 2.5 Environment Variables

Updated `.env.example`:

```bash
# Required
ANTHROPIC_API_KEY=your-api-key-here

# Authentication (set to protect your instance)
AUTH_TOKEN=your-secret-access-token

# Cloudflare Tunnel (only for docker-compose.tunnel.yml)
CLOUDFLARE_TUNNEL_TOKEN=your-tunnel-token-here
```

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/middleware.ts` | Modify | Add rate limiting logic |
| `next.config.ts` | Modify | Add security headers |
| `src/app/login/page.tsx` | Modify | Fix open redirect |
| `docker-compose.yml` | Keep | Local mode (existing, unchanged) |
| `docker-compose.tunnel.yml` | Create | Remote mode with Nginx + cloudflared |
| `nginx/nginx.conf` | Create | Reverse proxy configuration |
| `.env.example` | Modify | Add CLOUDFLARE_TUNNEL_TOKEN |
| `README.md` (+ CN/JA) | Modify | Add remote access documentation |

---

## Out of Scope

- Multi-user authentication (OAuth, user database)
- Custom SSL certificate management
- WAF / advanced firewall rules
- Monitoring / alerting infrastructure
