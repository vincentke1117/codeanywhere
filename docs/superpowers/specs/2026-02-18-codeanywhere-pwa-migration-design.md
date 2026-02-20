# CodeAnywhere PWA Migration Design

## Summary

将 CodePilot（Electron + Next.js 桌面应用）改造为 CodeAnywhere（纯 Web + PWA 应用），支持移动端通过浏览器访问。

## Requirements

- **品牌重塑**: CodePilot → CodeAnywhere
- **架构变更**: 去掉 Electron，改为纯 Next.js Web 服务 + PWA
- **部署模式**: 自托管服务器（本地或 VPS）
- **移动端**: 响应式自适应布局
- **用户模式**: 单用户
- **部署支持**: Docker 容器化部署

## Architecture

```
用户（手机/PC 浏览器）
        │
        ▼ (HTTPS + Token Auth)
  Next.js Web 服务 (自托管)
   ├── Auth Middleware          ← Token 认证中间件
   ├── API Routes (/api/*)     ← RESTful + SSE
   ├── React Pages (PWA)       ← 响应式 UI
   ├── SQLite (better-sqlite3) ← 本地数据存储
   └── Claude Agent SDK        ← 调用本地 Claude Code CLI
        │
        ▼
  Anthropic API
```

---

## Phase 0: Security Authentication

Since the application transitions from a local-only Electron app to a network-accessible web service, all API endpoints are now exposed. Without authentication, anyone who can reach the server URL has full access to API keys, file system browsing, and Claude Code execution.

### Authentication Scheme

**Token-based authentication** (simple, single-user):

- Server reads `AUTH_TOKEN` from environment variable or `.env.local`
- If `AUTH_TOKEN` is set, all requests require `Authorization: Bearer <token>` header
- If `AUTH_TOKEN` is not set, authentication is disabled (local-only use case)
- A Next.js middleware (`src/middleware.ts`) intercepts all `/api/*` routes and verifies the token
- Login page: simple token input form, stored in browser `localStorage`
- The token is automatically included in all API requests and SSE connections
- SSE connections: use `fetch`-based SSE parsing (not native `EventSource`) to include `Authorization` header — current codebase (`src/hooks/useSSEStream.ts`) already uses fetch-based SSE, so this is compatible

### Protected Resources

All API routes are protected, especially:
- `/api/settings/app` — exposes `anthropic_auth_token` and API keys
- `/api/files/raw`, `/api/files/browse` — server file system access
- `/api/chat` — Claude Code execution capability
- `/api/providers` — API provider credentials

### HTTPS Requirement

Document that when deployed on a network (not localhost), HTTPS/TLS is strongly recommended:
- Use reverse proxy (nginx/Caddy) with SSL termination
- Or deploy behind a VPN/tunnel (e.g., Tailscale, Cloudflare Tunnel)

---

## Phase 1: Brand Rebrand

### Global String Replacements

| Original | New | Scope |
|----------|-----|-------|
| `codepilot` | `codeanywhere` | Package name, data dirs, upload dirs, DB paths |
| `CodePilot` | `CodeAnywhere` | Product name, UI text, window titles |
| `~/.codepilot` | `~/.codeanywhere` | App data directory |
| `.codepilot-uploads` | `.codeanywhere-uploads` | File upload directory |
| `CLAUDE_GUI_DATA_DIR` | `CODEANYWHERE_DATA_DIR` | Environment variable |
| `com.codepilot.app` | `com.codeanywhere.app` | App ID |

### Affected Files (Complete List)

**Core config:**
- `package.json` — name, description
- `electron-builder.yml` — appId, productName (will be deleted in Phase 2)
- `CLAUDE.md` — project description

**Server-side logic:**
- `electron/main.ts` — data directory, service name
- `src/lib/db.ts` — data directory path `~/.codepilot`
- `src/lib/claude-client.ts` — upload directory `.codepilot-uploads`
- `src/app/api/chat/route.ts` — hardcoded `.codepilot-uploads` upload directory path
- `src/app/api/uploads/route.ts` — hardcoded `.codepilot-uploads` security path check
- `src/app/api/app/updates/route.ts` — `GITHUB_REPO = "op7418/CodePilot"`
- `src/app/api/settings/app/route.ts` — "CodePilot" in comments
- `src/app/api/claude-sessions/import/route.ts` — "CodePilot" in comments

**UI components:**
- `src/app/layout.tsx` — `title: "CodePilot"`
- `src/components/chat/CodePilotLogo.tsx` — component name and content
- `src/components/layout/ConnectionStatus.tsx` — `codepilot:install-wizard-dismissed` localStorage key
- `src/components/layout/AppShell.tsx` — `codepilot_chatlist_width`, `codepilot_rightpanel_width`, `codepilot_docpreview_width`, `codepilot_dismissed_update_version` localStorage keys
- `src/components/layout/ChatListPanel.tsx` — possible localStorage keys
- `src/components/layout/ImportSessionDialog.tsx` — codepilot references
- `src/components/settings/GeneralSection.tsx` — UI text "CodePilot"
- `src/components/settings/SettingsLayout.tsx` — CodePilot references
- `src/app/chat/[id]/page.tsx` — codepilot references

**Assets & docs:**
- `build/` — icon assets (replace with new brand icons)
- `README.md`, `README_CN.md`, `README_JA.md`
- `.github/workflows/build.yml` — "CodePilot" in Release descriptions and titles

**Tests:**
- `src/__tests__/unit/*.test.ts` — path references in test files

### Data Migration

On startup, detect if `~/.codepilot` exists:
1. Copy (not move) `codepilot.db`, `codepilot.db-wal`, `codepilot.db-shm` to `~/.codeanywhere/`
2. On success, rename old directory to `~/.codepilot.migrated` as backup
3. On failure, log error and continue using old directory path as fallback
4. Handle WAL mode lock files properly (ensure no other process holds a lock)

---

## Phase 2: Remove Electron

### Files to Delete

| File/Directory | Current Role | Action |
|---------------|-------------|--------|
| `electron/main.ts` | Window management, server process, IPC, install wizard | **Delete** |
| `electron/preload.ts` | contextBridge, IPC bridging | **Delete** |
| `electron/tsconfig.json` | Electron TS config | **Delete** |
| `electron-builder.yml` | Build config | **Delete** |
| `scripts/build-electron.mjs` | esbuild for Electron | **Delete** |
| `scripts/after-pack.js` | better-sqlite3 native module rebuild | **Delete** |
| `src/components/layout/InstallWizard.tsx` | Node.js/Claude CLI install detection | **Delete** |
| `src/app/api/app/updates/` | Update check API | **Delete** |

### Files to Modify (Electron Removal)

**`src/components/layout/UpdateDialog.tsx` and `src/hooks/useUpdate.ts`:**
- Cannot simply delete — `useUpdate` exports `UpdateContext` which is used as a Provider in `AppShell.tsx`, and `GeneralSection.tsx` depends on `useUpdate()` hook
- Action: Remove `UpdateContext` Provider from `AppShell.tsx`, remove `UpdateCard` from `GeneralSection.tsx`, then delete both files

**`src/components/layout/ConnectionStatus.tsx`:**
- Contains extensive `isElectron` detection, `window.electronAPI` calls, and auto-triggers `InstallWizard`
- In Web/PWA mode, Claude CLI runs on the server, not the user's machine — the concept of "install wizard" is irrelevant
- Action: Redesign to check server-side Claude CLI availability via a health-check API (`/api/claude-status`), show server connection status instead of local install status. Remove all `window.electronAPI` references and `isElectron` logic

**`src/components/layout/AppShell.tsx`:**
- Remove `UpdateContext.Provider` wrapping
- Remove all update-check related state and logic: `CHECK_INTERVAL`, `DISMISSED_VERSION_KEY` constants, `checkForUpdates`/`dismissUpdate`/`updateContextValue` state management, `hasUpdate` prop passed to NavRail, `<UpdateDialog />` component reference
- Remove Electron-specific window title bar styling (`titleBarStyle` related CSS)
- Keep existing `LG_BREAKPOINT = 1024` and `matchMedia` logic — Phase 4 will extend this, not replace it

**`src/lib/platform.ts`:**
- `findClaudeBinary()` has path detection logic for local machine — in Web mode, Claude CLI is on the server, so this works correctly for self-hosted deployment
- Remove any browser-side platform detection that references Electron

### Components to Modify

**Window Title Bar:**
- Remove custom Electron `titleBarStyle` logic
- Use browser native title bar; PWA standalone mode uses CSS top navigation

**Environment Variables:**
- Replace `loadUserShellEnv()` with Next.js `.env.local` support
- Server reads from system environment or `.env` file

**IPC Communication:**
- Remove all `window.electronAPI` references
- Functionality previously via IPC either becomes REST API or gets deleted

**Native Module ABI Check:**
- Delete `checkNativeModuleABI()` — no Electron ABI mismatch in pure Node.js

**Server Process Management:**
- Delete `utilityProcess.fork()` — run directly via `next start` or `node server.js`

### Dependency Changes

**Remove:**
- `electron` (40.2.1)
- `electron-builder` (26.0.12)
- `@electron/rebuild`
- `wait-on`
- `concurrently` (only used for `electron:dev` script)
- `esbuild` (only used for `scripts/build-electron.mjs`)

**Keep:**
- `better-sqlite3` — server-side SQLite
- `@anthropic-ai/claude-agent-sdk` — server-side Claude integration

### Script Changes

```json
{
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint"
}
```

### CI/CD Changes

Replace multi-platform Electron build matrix with:
- Single Node.js build validation
- Docker image build and push (optional)

---

## Phase 3: PWA Support

### Web App Manifest (`public/manifest.json`)

```json
{
  "name": "CodeAnywhere",
  "short_name": "CodeAnywhere",
  "description": "Claude Code Web GUI Client",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0a0a0a",
  "theme_color": "#0a0a0a",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

### Service Worker Implementation

**Library**: Use `serwist` (modern Workbox successor with Next.js App Router support) via `@serwist/next`.

**Integration**:
- Configure in `next.config.ts` via `withSerwist()` wrapper
- Service Worker source at `src/app/sw.ts`, compiled and served automatically
- SSE streams (`/api/chat`) must be excluded from Service Worker fetch interception to prevent buffering issues — use `navigationPreload` and route exclusion

**Registration & Update Strategy**:
- Register on page load, prompt user to reload when new version available
- Use `skipWaiting` + `clientsClaim` for immediate activation

### Caching Strategy

| Resource Type | Strategy |
|--------------|----------|
| Static assets (JS/CSS/images) | Cache First |
| API requests (`/api/*`) | Network First |
| SSE streams (`/api/chat`) | Network Only |
| HTML pages | Stale While Revalidate |

### Next.js Config Changes (`next.config.ts`)

- Keep `output: 'standalone'` — required for self-hosted and Docker deployment
- Add `@serwist/next` wrapper via `withSerwist()` for Service Worker compilation
- Add PWA-related headers configuration if needed

### Head Metadata (`src/app/layout.tsx`)

- `<link rel="manifest" href="/manifest.json">`
- `<meta name="theme-color" content="#0a0a0a">`
- `<meta name="apple-mobile-web-app-capable" content="yes">`
- `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`
- Apple Touch Icon references

### PWA Install Prompt

Listen for `beforeinstallprompt` event, show non-intrusive "Add to Home Screen" button in UI.

### Offline Behavior

- **Available offline**: Cached chat history, app shell (layout and navigation)
- **Not available offline**: New messages, file operations, settings changes
- Show friendly "waiting for connection" notice when offline

---

## Phase 4: Responsive UI

### Breakpoint Strategy (Tailwind CSS)

Note: `AppShell.tsx` already has `LG_BREAKPOINT = 1024` with `matchMedia` logic for sidebar toggling. Phase 4 extends this existing system rather than replacing it.

| Breakpoint | Width | Layout |
|-----------|-------|--------|
| **mobile** | < 768px | Single column, sidebar/panel as drawers |
| **tablet** | 768px - 1024px | Two columns, right panel collapsed |
| **desktop** | > 1024px | Three columns (same as current) |

### Layout: AppShell

**Desktop (unchanged):**
```
┌──────┬──────────────┬────────┐
│NavRail│   Main Chat   │ Right  │
│+List  │               │ Panel  │
└──────┴──────────────┴────────┘
```

**Mobile:**
```
┌────────────────────┐
│   Top Navigation    │  ← Hamburger + Title + Actions
├────────────────────┤
│                    │
│    Main Chat       │  ← Full width
│                    │
├────────────────────┤
│   Message Input    │
└────────────────────┘

Sidebar: Left drawer (overlay)
Right Panel: Bottom sheet or right drawer
```

### Component-Level Changes

| Component | Desktop | Mobile |
|-----------|---------|--------|
| `NavRail` | Fixed left nav | Hidden, hamburger triggers left drawer |
| `ChatListPanel` | Fixed sidebar | Merged into left drawer |
| `Header` | Top bar | Simplified, add hamburger button |
| `MessageInput` | Bottom input area | Bottom fixed, larger touch targets |
| `MessageList` | Standard list | Touch-friendly spacing, horizontal scroll for code |
| `RightPanel` | Fixed right panel | Bottom sheet or fullscreen overlay |
| `FileTree` | Tree structure | Unchanged, touch-friendly spacing |
| `ToolCallBlock` | Collapsible panel | Unchanged, prevent overflow |
| `CodeBlock` | Code highlighting | Add horizontal scroll, prevent tiny text |

### Touch Optimization

- Minimum touch target: 44x44px
- Appropriate message item spacing
- Swipe gesture support (swipe to close drawers)
- Virtual keyboard handling with `visual-viewport` API

### Viewport Configuration

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
```

Note: Do NOT use `maximum-scale=1` as it disables user zoom and violates WCAG 2.1 accessibility standards.

`viewport-fit=cover` for iPhone safe areas (notch/home indicator).

---

## Phase 5: Docker Deployment

### Dockerfile

Multi-stage build based on Next.js standalone output:

```
Stage 1: deps    — Install npm dependencies (including better-sqlite3 compilation)
Stage 2: builder — next build to generate standalone output
Stage 3: runner  — Minimal runtime image (node:20-slim)
```

Key points:
- `better-sqlite3` must be compiled in target environment
- Standalone mode generates self-contained `server.js`
- Claude Code CLI installed in container via `npm install -g @anthropic-ai/claude-code`
- Container needs `git`, `bash`, and other dev tools that Claude Code CLI depends on
- `~/.claude/` config directory (settings.json, MCP configs) must be persisted via volume mount
- `src/lib/platform.ts` `findClaudeBinary()` works in container since Claude CLI is installed globally

### docker-compose.yml

```yaml
services:
  codeanywhere:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - codeanywhere-data:/root/.codeanywhere    # SQLite database
      - claude-config:/root/.claude              # Claude Code config
      - /path/to/projects:/workspace             # Project files
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - AUTH_TOKEN=${AUTH_TOKEN}                  # Web auth token

volumes:
  codeanywhere-data:
  claude-config:
```

### Volume Mounts

- `codeanywhere-data` — SQLite database persistence
- `claude-config` — Claude Code CLI configuration (`settings.json`, MCP configs, custom commands)
- `/workspace` — Project files for Claude Code to operate on

---

## Implementation Order

| Phase | Content | Deliverable |
|-------|---------|-------------|
| Phase 0 | Security Authentication | Token auth middleware, login page, HTTPS docs |
| Phase 1 | Brand Rebrand | All naming (21+ files), icons, data dirs replaced, migration logic |
| Phase 2 | Remove Electron | Electron layer deleted, deps cleaned, startup method updated, CI updated |
| Phase 3 | PWA Support | manifest, Service Worker (serwist), install prompt, viewport config |
| Phase 4 | Responsive UI | Breakpoint adaptation, drawer components, touch optimization |
| Phase 5 | Docker Deployment | Dockerfile, docker-compose, documentation |

**Dependencies**: Phase 0-2 are sequential (each depends on the previous). Phase 3 and Phase 4 are partially coupled — PWA `standalone` display mode removes the browser navigation bar, so Phase 4's mobile top navigation design must account for this. Implement Phase 3 first, then Phase 4.

Each phase can be independently tested and verified.

---

*Design approved: 2026-02-18*
*Based on CodePilot v0.10.11*
