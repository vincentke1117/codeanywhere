# CodeAnywhere PWA Migration — Implementation Plan

> **For Claude:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform CodePilot (Electron + Next.js desktop app) into CodeAnywhere (pure Web + PWA), accessible from mobile devices via browser.

**Architecture:** Remove Electron shell, keep Next.js as a standalone web server with token-based auth. Add PWA manifest and Service Worker for mobile install. Retrofit responsive UI with Tailwind breakpoints. Package with Docker for self-hosted deployment.

**Tech Stack:** Next.js 16 (App Router), React 19, Tailwind CSS 4, better-sqlite3, @anthropic-ai/claude-agent-sdk, serwist (Service Worker), Docker

**Spec:** `docs/superpowers/specs/2026-02-18-codeanywhere-pwa-migration-design.md`

---

## File Structure Overview

### New files to create:
- `src/middleware.ts` — Next.js auth middleware (token verification)
- `src/app/login/page.tsx` — Login page (token input form)
- `src/lib/auth.ts` — Auth helper (token storage, header injection)
- `public/manifest.json` — PWA Web App Manifest
- `src/app/sw.ts` — Service Worker source (serwist)
- `src/hooks/usePWAInstall.ts` — PWA install prompt hook
- `src/components/layout/MobileDrawer.tsx` — Mobile slide-out drawer component
- `Dockerfile` — Multi-stage Docker build
- `docker-compose.yml` — Docker Compose config
- `.dockerignore` — Docker ignore file

### Files to delete (Phase 2):
- `electron/main.ts`, `electron/preload.ts`, `electron/tsconfig.json`
- `electron-builder.yml`
- `scripts/build-electron.mjs`, `scripts/after-pack.js`
- `src/components/layout/InstallWizard.tsx`
- `src/components/layout/UpdateDialog.tsx`
- `src/hooks/useUpdate.ts`
- `src/app/api/app/updates/route.ts`

### Files to modify (across phases):
- `package.json` — name, deps, scripts
- `next.config.ts` — serwist wrapper
- `src/app/layout.tsx` — title, PWA metadata, viewport
- `src/lib/db.ts` — data directory path
- `src/lib/claude-client.ts` — upload directory
- `src/lib/platform.ts` — remove Electron refs
- `src/app/api/chat/route.ts` — upload dir
- `src/app/api/uploads/route.ts` — security path
- `src/hooks/useSSEStream.ts` — auth header injection
- `src/components/layout/AppShell.tsx` — remove update logic, add responsive
- `src/components/layout/ConnectionStatus.tsx` — remove Electron detection
- `src/components/layout/Header.tsx` — add hamburger for mobile
- `src/components/layout/NavRail.tsx` — remove update badge, mobile drawer
- `src/components/layout/ChatListPanel.tsx` — localStorage keys
- `src/components/layout/RightPanel.tsx` — mobile bottom sheet
- `src/components/settings/GeneralSection.tsx` — remove UpdateCard
- `src/components/chat/MessageInput.tsx` — touch targets
- `src/components/chat/CodeBlock.tsx` — horizontal scroll
- Various other files — brand name string replacements

---

## Chunk 1: Phase 0 — Security Authentication

### Task 1: Create auth token verification utility

**Files:**
- Create: `src/lib/auth.ts`

- [ ] **Step 1: Create `src/lib/auth.ts`**

```typescript
// src/lib/auth.ts

/**
 * Server-side: verify auth token from request header.
 * If AUTH_TOKEN env var is not set, authentication is disabled.
 */
export function verifyAuthToken(request: Request): boolean {
  const authToken = process.env.AUTH_TOKEN;

  // If no AUTH_TOKEN configured, auth is disabled (local-only mode)
  if (!authToken) return true;

  const authorization = request.headers.get("Authorization");
  if (!authorization) return false;

  const [scheme, token] = authorization.split(" ");
  if (scheme !== "Bearer" || !token) return false;

  return token === authToken;
}

/**
 * Client-side: get stored auth token from localStorage.
 */
export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("codeanywhere_auth_token");
}

/**
 * Client-side: store auth token in localStorage.
 */
export function setStoredToken(token: string): void {
  localStorage.setItem("codeanywhere_auth_token", token);
}

/**
 * Client-side: remove stored auth token.
 */
export function clearStoredToken(): void {
  localStorage.removeItem("codeanywhere_auth_token");
}

/**
 * Client-side: check if auth is required by querying the server.
 * Returns true if the server requires authentication (401 response).
 * Returns null if the server is unreachable (unknown state).
 */
export async function isAuthRequired(): Promise<boolean | null> {
  try {
    const res = await fetch("/api/health");
    return res.status === 401;
  } catch {
    return null; // Server unreachable — distinct from "no auth needed"
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/auth.ts
git commit -m "feat(auth): add token verification and client-side auth utilities"
```

---

### Task 2: Create Next.js auth middleware

**Files:**
- Create: `src/middleware.ts`

- [ ] **Step 1: Create `src/middleware.ts`**

```typescript
// src/middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

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

- [ ] **Step 2: Commit**

```bash
git add src/middleware.ts
git commit -m "feat(auth): add Next.js middleware for token-based route protection"
```

---

### Task 3: Create login page

**Files:**
- Create: `src/app/login/page.tsx`

- [ ] **Step 1: Create `src/app/login/page.tsx`**

```tsx
// src/app/login/page.tsx
"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { setStoredToken } from "@/lib/auth";

export default function LoginPage() {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // Verify token by calling health endpoint
      const res = await fetch("/api/health", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        setStoredToken(token);
        const redirect = searchParams.get("redirect") || "/";
        router.push(redirect);
      } else {
        setError("Invalid token");
      }
    } catch {
      setError("Connection failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">CodeAnywhere</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Enter your access token to continue
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Access Token"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            autoFocus
          />
          {error && (
            <p className="text-sm text-red-500">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading || !token}
            className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {loading ? "Verifying..." : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/login/page.tsx
git commit -m "feat(auth): add login page with token input form"
```

---

### Task 4: Create authFetch wrapper and replace all client-side API calls

**Files:**
- Create: `src/lib/api-client.ts`
- Modify: `src/components/chat/ChatView.tsx` (line 201: SSE fetch call — the core chat API request)
- Modify: All files containing `fetch("/api/` calls

Note: `src/hooks/useSSEStream.ts` does NOT contain fetch calls — it receives a `ReadableStreamDefaultReader`. The actual SSE `fetch('/api/chat', ...)` call is in `ChatView.tsx` line 201.

- [ ] **Step 1: Create `src/lib/api-client.ts`**

```typescript
// src/lib/api-client.ts
import { getStoredToken } from "@/lib/auth";

/**
 * Authenticated fetch wrapper. Automatically adds Authorization header
 * if a token is stored in localStorage.
 */
export async function authFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const token = getStoredToken();
  const headers = new Headers(init?.headers);

  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(input, { ...init, headers });

  // If 401, redirect to login
  if (response.status === 401 && typeof window !== "undefined") {
    const currentPath = window.location.pathname;
    if (currentPath !== "/login") {
      window.location.href = `/login?redirect=${encodeURIComponent(currentPath)}`;
    }
  }

  return response;
}
```

- [ ] **Step 2: Find all client-side fetch("/api/") calls**

```bash
grep -rn 'fetch("/api/\|fetch(`/api/' src/components/ src/app/ src/hooks/ --include="*.tsx" --include="*.ts"
```

Key files that will need updating (non-exhaustive — grep results will be definitive):
- `src/components/chat/ChatView.tsx` — line 201: `fetch('/api/chat', ...)` (SSE stream, most critical)
- `src/components/chat/MessageInput.tsx` — file/skill fetching
- `src/components/layout/ConnectionStatus.tsx` — status check
- `src/components/layout/ChatListPanel.tsx` — session list
- `src/components/settings/GeneralSection.tsx` — settings
- `src/components/settings/ProviderManager.tsx` — providers
- `src/components/plugins/McpManager.tsx` — MCP plugins
- `src/app/chat/[id]/page.tsx` — session loading

- [ ] **Step 3: Replace each `fetch("/api/...` with `authFetch("/api/...`**

For each file found in Step 2:
1. Add `import { authFetch } from "@/lib/auth-client";` at the top
2. Replace `fetch("/api/...` with `authFetch("/api/...`
3. Replace `fetch(\`/api/...` with `authFetch(\`/api/...`

- [ ] **Step 4: Verify dev server runs and login flow works**

Run: `npm run dev`
- Without AUTH_TOKEN set: all routes accessible without login
- With `AUTH_TOKEN=test123` in `.env.local`: redirected to /login, entering "test123" grants access
- Verify chat SSE stream works after login

- [ ] **Step 5: Commit**

```bash
git add src/lib/api-client.ts src/components/ src/app/ src/hooks/
git commit -m "feat(auth): add authFetch wrapper, replace all client-side fetch calls including SSE"
```

---

## Chunk 2: Phase 1 — Brand Rebrand

### Task 6: Rename package and core config files

**Files:**
- Modify: `package.json` (line 2: name)
- Modify: `CLAUDE.md`
- Modify: `electron-builder.yml` (line 1: appId, line 2: productName — will be deleted later)

- [ ] **Step 1: Update `package.json`**

```
Line 2: "name": "codepilot" → "name": "codeanywhere"
```

- [ ] **Step 2: Update `CLAUDE.md`**

Replace all occurrences of `CodePilot` → `CodeAnywhere` and `codepilot` → `codeanywhere`.

- [ ] **Step 3: Update `electron-builder.yml`**

```
appId: com.codepilot.app → appId: com.codeanywhere.app
productName: CodePilot → productName: CodeAnywhere
```

- [ ] **Step 4: Run `npm install` to sync package-lock.json**

Run: `npm install`
Expected: package-lock.json updates its name field

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json CLAUDE.md electron-builder.yml
git commit -m "chore(rebrand): rename package and config to CodeAnywhere"
```

---

### Task 7: Rename data directory and add migration logic

**Files:**
- Modify: `src/lib/db.ts` (lines 8-9, 20-48)
- Modify: `electron/main.ts` (data directory references)

- [ ] **Step 1: Update `src/lib/db.ts` data directory and DB name**

```typescript
// Line 8: Change env var name and default directory
const dataDir = process.env.CODEANYWHERE_DATA_DIR || path.join(os.homedir(), '.codeanywhere');

// Line 9: Change DB filename
const DB_PATH = path.join(dataDir, 'codeanywhere.db');
```

- [ ] **Step 2: Add `~/.codepilot` → `~/.codeanywhere` migration logic in `src/lib/db.ts`**

Add a new function before the existing `migrateDb()` that handles directory-level migration:

```typescript
function migrateFromCodePilot(): void {
  const home = os.homedir();
  const oldDir = path.join(home, '.codepilot');
  const newDir = path.join(home, '.codeanywhere');

  // Skip if old dir doesn't exist or new dir already has a database
  if (!fs.existsSync(oldDir)) return;
  if (fs.existsSync(path.join(newDir, 'codeanywhere.db'))) return;

  try {
    // Ensure new directory exists
    fs.mkdirSync(newDir, { recursive: true });

    // Copy database files (not move — keep old as backup)
    const filesToCopy = ['codepilot.db', 'codepilot.db-wal', 'codepilot.db-shm'];
    for (const file of filesToCopy) {
      const src = path.join(oldDir, file);
      if (fs.existsSync(src)) {
        // For the main db file, rename to new name; for WAL/SHM keep extensions
        const destName = file === 'codepilot.db'
          ? 'codeanywhere.db'
          : file.replace('codepilot.db', 'codeanywhere.db');
        fs.copyFileSync(src, path.join(newDir, destName));
      }
    }

    // Mark old directory as migrated
    fs.renameSync(oldDir, oldDir + '.migrated');
    console.log('[db] Migrated data from ~/.codepilot to ~/.codeanywhere');
  } catch (err) {
    console.error('[db] Migration from ~/.codepilot failed, continuing with new directory:', err);
  }
}
```

Call `migrateFromCodePilot()` before `ensureDir(dataDir)`.

Also update the existing `oldPaths` array in `migrateDb()` to include `~/.codepilot/codepilot.db` as a legacy source.

- [ ] **Step 3: Update `electron/main.ts`**

Replace all `codepilot` → `codeanywhere` references in data directory paths.

- [ ] **Step 4: Commit**

```bash
git add src/lib/db.ts electron/main.ts
git commit -m "chore(rebrand): rename data directory to .codeanywhere with migration from .codepilot"
```

---

### Task 8: Rename upload directory references

**Files:**
- Modify: `src/lib/claude-client.ts` (line 211)
- Modify: `src/app/api/chat/route.ts` (line 36)
- Modify: `src/app/api/uploads/route.ts` (line 38)

- [ ] **Step 1: Update `src/lib/claude-client.ts`**

```typescript
// Line 211:
const uploadDir = path.join(workDir, '.codeanywhere-uploads');
```

- [ ] **Step 2: Update `src/app/api/chat/route.ts`**

```typescript
// Line 36:
const uploadDir = path.join(workDir, '.codeanywhere-uploads');
```

- [ ] **Step 3: Update `src/app/api/uploads/route.ts`**

```typescript
// Line 23-24: Update comments mentioning .codepilot-uploads
// Line 38: Update security check
if (!resolved.includes('.codeanywhere-uploads')) {
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/claude-client.ts src/app/api/chat/route.ts src/app/api/uploads/route.ts
git commit -m "chore(rebrand): rename upload directory to .codeanywhere-uploads"
```

---

### Task 9: Rename CodePilotLogo component and update all imports

**Files:**
- Rename: `src/components/chat/CodePilotLogo.tsx` → `src/components/chat/CodeAnywhereLogo.tsx`
- Modify: `src/components/chat/MessageList.tsx` (line 13: imports CodePilotLogo, line 90: uses it)
- Modify: Any other files importing CodePilotLogo

- [ ] **Step 1: Rename the file**

```bash
mv src/components/chat/CodePilotLogo.tsx src/components/chat/CodeAnywhereLogo.tsx
```

- [ ] **Step 2: Update the component name inside the file**

Replace `CodePilotLogo` with `CodeAnywhereLogo` in the file content (function name, export).

- [ ] **Step 3: Update `MessageList.tsx` import (line 13) and usage (line 90)**

```typescript
// Line 13: import CodeAnywhereLogo from "./CodeAnywhereLogo";
// Line 90: <CodeAnywhereLogo ... />
```

- [ ] **Step 4: Search for any other imports and update them**

```bash
grep -rn "CodePilotLogo" src/ --include="*.tsx" --include="*.ts"
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(rebrand): rename CodePilotLogo to CodeAnywhereLogo"
```

---

### Task 9b: Replace all localStorage keys with codeanywhere prefix

**Files:**
- Modify: `src/components/layout/AppShell.tsx` (lines 33, 43, 47, 55, 65)
- Modify: `src/components/layout/ConnectionStatus.tsx` (line 101)
- Modify: `src/components/layout/ChatListPanel.tsx` (lines 53, 134, 151, 163)
- Modify: `src/app/chat/[id]/page.tsx`

- [ ] **Step 1: Replace in `AppShell.tsx`**

```
codepilot_chatlist_width → codeanywhere_chatlist_width
codepilot_rightpanel_width → codeanywhere_rightpanel_width
codepilot_docpreview_width → codeanywhere_docpreview_width
codepilot_dismissed_update_version → codeanywhere_dismissed_update_version
```

- [ ] **Step 2: Replace in `ConnectionStatus.tsx`**

```
codepilot:install-wizard-dismissed → codeanywhere:install-wizard-dismissed
```

- [ ] **Step 3: Replace in `ChatListPanel.tsx`**

All 4 occurrences:
```
Line 53: codepilot:collapsed-projects → codeanywhere:collapsed-projects
Line 134: codepilot:last-working-directory (getItem) → codeanywhere:last-working-directory
Line 151: codepilot:last-working-directory (removeItem) → codeanywhere:last-working-directory
Line 163: codepilot:last-working-directory (removeItem) → codeanywhere:last-working-directory
```

- [ ] **Step 4: Replace in `src/app/chat/[id]/page.tsx`**

```
codepilot:last-working-directory → codeanywhere:last-working-directory
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(rebrand): replace all codepilot localStorage keys with codeanywhere"
```

---

### Task 9c: Replace UI text and page title

**Files:**
- Modify: `src/app/layout.tsx` (line 18-19)
- Modify: `src/components/settings/GeneralSection.tsx`
- Modify: `src/components/settings/SettingsLayout.tsx`
- Modify: `src/components/layout/ImportSessionDialog.tsx`

- [ ] **Step 1: Update `src/app/layout.tsx`**

```typescript
// Line 18:
title: "CodeAnywhere",
// Line 19:
description: "A web GUI for Claude Code",
```

- [ ] **Step 2: Replace "CodePilot" text in settings components**

In `GeneralSection.tsx` and `SettingsLayout.tsx`: replace "CodePilot" text with "CodeAnywhere".

- [ ] **Step 3: Update `ImportSessionDialog.tsx`**

Replace any "codepilot"/"CodePilot" references.

- [ ] **Step 4: Verify the app builds without errors**

Run: `npm run build`
Expected: Build succeeds with no TypeScript errors

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(rebrand): rename all UI text to CodeAnywhere"
```

---

### Task 10: Update remaining files (API routes, docs, CI, tests)

**Files:**
- Modify: `src/app/api/app/updates/route.ts` — `GITHUB_REPO = "op7418/CodePilot"`
- Modify: `src/app/api/settings/app/route.ts` — "CodePilot" in comments
- Modify: `src/app/api/claude-sessions/import/route.ts` — "CodePilot" in comments
- Modify: `.github/workflows/build.yml` — "CodePilot" in release titles/descriptions (lines 171, 174, 175, 186, 211)
- Modify: `README.md`, `README_CN.md`, `README_JA.md`
- Modify: `src/__tests__/unit/db-shutdown.test.ts` — `CLAUDE_GUI_DATA_DIR` env var → `CODEANYWHERE_DATA_DIR` (lines 20-21, 83)
- Modify: `src/__tests__/unit/claude-session-parser.test.ts` — temp dir name (line 17)
- Modify: `src/__tests__/unit/message-persistence.test.ts` — test data literals (lines 40-41)

- [ ] **Step 1: Update API route files**

In `src/app/api/app/updates/route.ts`:
```typescript
// Replace GITHUB_REPO value:
const GITHUB_REPO = "op7418/CodeAnywhere"; // or new repo name
```

In `src/app/api/settings/app/route.ts` and `src/app/api/claude-sessions/import/route.ts`:
Replace "CodePilot" in comments with "CodeAnywhere".

- [ ] **Step 2: Update `.github/workflows/build.yml`**

Replace all "CodePilot" with "CodeAnywhere" in release descriptions, titles, and installation instructions.

- [ ] **Step 3: Update README files**

Replace product name, descriptions, and URLs in `README.md`, `README_CN.md`, `README_JA.md`.

- [ ] **Step 4: Update test files**

In `src/__tests__/unit/db-shutdown.test.ts`:
```typescript
// Lines 20-21, 83: Replace CLAUDE_GUI_DATA_DIR with CODEANYWHERE_DATA_DIR
// Replace codepilot.db with codeanywhere.db
```

In other test files: update any `codepilot` string literals.

- [ ] **Step 5: Verify no remaining references**

```bash
grep -rn "codepilot\|CodePilot\|CODEPILOT" src/ .github/ *.md --include="*.ts" --include="*.tsx" --include="*.md" --include="*.yml"
```
Expected: Zero results except intentional migration/legacy code in `db.ts`

- [ ] **Step 6: Verify build and tests**

Run: `npm run build`
Expected: Success

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore(rebrand): complete brand rename to CodeAnywhere across all remaining files"
```

---

## Chunk 3: Phase 2 — Remove Electron

### Task 11: Remove update system (UpdateDialog, useUpdate, UpdateContext)

**Files:**
- Modify: `src/components/layout/AppShell.tsx` — remove UpdateContext.Provider, update-check logic, UpdateDialog
- Modify: `src/components/settings/GeneralSection.tsx` — remove UpdateCard
- Modify: `src/components/layout/NavRail.tsx` — remove hasUpdate badge
- Delete: `src/components/layout/UpdateDialog.tsx`
- Delete: `src/hooks/useUpdate.ts`
- Delete: `src/app/api/app/updates/route.ts`

- [ ] **Step 1: Remove UpdateCard from `GeneralSection.tsx`**

- Remove `import { useUpdate } from "@/hooks/useUpdate"` (line 18)
- Remove `const { updateInfo, checking, checkForUpdates } = useUpdate()` (line 21)
- Remove the entire `UpdateCard` component (lines 20-71)
- Remove `<UpdateCard />` from the render return

- [ ] **Step 2: Remove update logic from `AppShell.tsx`**

- Remove `import { UpdateContext } from "@/hooks/useUpdate"` (or similar import)
- Remove `import UpdateDialog from "./UpdateDialog"`
- Remove constants: `CHECK_INTERVAL`, `DISMISSED_VERSION_KEY` (lines 32-33)
- Remove all update-check state variables and `checkForUpdates`/`dismissUpdate`/`updateContextValue` logic (lines 169-219)
- Remove `hasUpdate` prop passed to `<NavRail>` (line 253)
- Remove `<UpdateContext.Provider>` wrapping (line 246)
- Remove `<UpdateDialog />` component (line 285)

- [ ] **Step 3: Remove `hasUpdate` prop from `NavRail.tsx`**

- Remove the `hasUpdate` prop from the component interface
- Remove the blue dot indicator (lines 97-99)

- [ ] **Step 4: Delete update-related files**

```bash
rm src/components/layout/UpdateDialog.tsx
rm src/hooks/useUpdate.ts
rm -rf src/app/api/app/updates/
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: Success with no missing import errors

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove Electron update system (UpdateDialog, useUpdate, UpdateContext)"
```

---

### Task 12: Remove InstallWizard and Electron detection from ConnectionStatus

**Files:**
- Delete: `src/components/layout/InstallWizard.tsx` (412 lines)
- Modify: `src/components/layout/ConnectionStatus.tsx`

- [ ] **Step 1: Delete InstallWizard**

```bash
rm src/components/layout/InstallWizard.tsx
```

- [ ] **Step 2: Simplify `ConnectionStatus.tsx`**

Remove:
- The `isElectron` detection logic (lines 30-33)
- The InstallWizard import and state
- The `codeanywhere:install-wizard-dismissed` localStorage check (line 101)
- Auto-trigger InstallWizard logic (lines 91-107)
- All `window.electronAPI` references

Keep:
- The `/api/claude-status` health check (`checkStatus()` at line 50)
- The status indicator UI (connected/disconnected)

The component should simply poll `/api/claude-status` and show connection state.

- [ ] **Step 3: Remove InstallWizard imports from any parent components**

Search for any component that imports or renders `<InstallWizard />` and remove those references.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: Success

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: remove InstallWizard and Electron detection from ConnectionStatus"
```

---

### Task 13: Remove Electron title bar styling from AppShell

**Files:**
- Modify: `src/components/layout/AppShell.tsx`

- [ ] **Step 1: Remove Electron-specific title bar CSS**

Search for any `titleBarStyle`, `--title-bar-height`, `env(titlebar-area-*)`, or platform-specific title bar offsets in AppShell.tsx. Remove them.

The PWA standalone mode will use the standard CSS top navigation designed in Phase 4.

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Success

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/AppShell.tsx
git commit -m "refactor: remove Electron title bar styling from AppShell"
```

---

### Task 14: Remove Electron references from platform.ts

**Files:**
- Modify: `src/lib/platform.ts`

- [ ] **Step 1: Review and clean `platform.ts`**

The file (237 lines) contains server-side platform detection (`isWindows`, `isMac`, `findClaudeBinary()`, `findGitBash()`). These are all valid for server-side use.

Remove any code that:
- References `electron` or Electron-specific paths
- Detects whether running inside Electron

Keep all `findClaudeBinary()` logic — it runs on the server where Claude CLI is installed.

- [ ] **Step 2: Commit**

```bash
git add src/lib/platform.ts
git commit -m "refactor: remove Electron references from platform.ts"
```

---

### Task 15: Delete Electron files and build scripts

**Files:**
- Delete: `electron/main.ts`
- Delete: `electron/preload.ts`
- Delete: `electron/tsconfig.json`
- Delete: `electron-builder.yml`
- Delete: `scripts/build-electron.mjs`
- Delete: `scripts/after-pack.js`

- [ ] **Step 1: Delete all Electron-specific files**

```bash
rm -rf electron/
rm electron-builder.yml
rm scripts/build-electron.mjs scripts/after-pack.js
```

- [ ] **Step 2: Remove `"main": "dist-electron/main.js"` from `package.json`**

This field tells Electron where to find the main process entry point. Remove it.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor: delete Electron main process, preload, and build scripts"
```

---

### Task 16: Remove Electron dependencies and scripts from package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Remove Electron dev dependencies**

Remove from `devDependencies`:
- `electron`
- `electron-builder`
- `wait-on`
- `concurrently`
- `esbuild`

- [ ] **Step 2: Remove Electron scripts**

Remove from `scripts`:
- `electron:dev`
- `electron:build`
- `electron:pack`
- `electron:pack:mac`
- `electron:pack:win`
- `electron:pack:linux`

Keep:
```json
{
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint"
}
```

- [ ] **Step 3: Run npm install to clean dependencies**

```bash
npm install
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: Success

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "refactor: remove Electron deps and scripts from package.json"
```

---

### Task 17: Update CI/CD workflow

**Files:**
- Modify: `.github/workflows/build.yml`

- [ ] **Step 1: Replace the multi-platform Electron build with a simple web build**

Replace the entire workflow content with a simplified CI:

```yaml
name: Build & Release

on:
  push:
    branches: [main]
    tags: ['v*']
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build
      - run: npm run lint

  docker:
    needs: build
    if: startsWith(github.ref, 'refs/tags/v')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/build-push-action@v5
        with:
          context: .
          push: false
          tags: codeanywhere:${{ github.ref_name }}
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/build.yml
git commit -m "ci: replace Electron multi-platform build with web build + Docker"
```

---

## Chunk 4: Phase 3 — PWA Support

### Task 18: Add PWA manifest and icons

**Files:**
- Create: `public/manifest.json`
- Create: `public/icons/` directory with PWA icons

- [ ] **Step 1: Create `public/manifest.json`**

```json
{
  "name": "CodeAnywhere",
  "short_name": "CodeAnywhere",
  "description": "Claude Code Web GUI Client",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0a0a0a",
  "theme_color": "#0a0a0a",
  "orientation": "any",
  "icons": [
    {
      "src": "/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    },
    {
      "src": "/icons/icon-maskable-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ]
}
```

- [ ] **Step 2: Create placeholder PWA icons**

Generate 192x192 and 512x512 PNG icons from the existing `build/icon.png` (386KB, already exists):

```bash
mkdir -p public/icons
# Use the existing icon or create placeholders — replace with actual branded icons later
cp build/icon.png public/icons/icon-512.png
cp build/icon.png public/icons/icon-192.png
cp build/icon.png public/icons/icon-maskable-512.png
```

Note: Proper icon resizing should be done with an image tool. For now, copies serve as placeholders.

- [ ] **Step 3: Commit**

```bash
git add public/manifest.json public/icons/
git commit -m "feat(pwa): add Web App Manifest and placeholder icons"
```

---

### Task 19: Add PWA metadata to layout.tsx

**Files:**
- Modify: `src/app/layout.tsx` (39 lines)

- [ ] **Step 1: Add PWA metadata to the `<head>` section**

In the metadata and viewport exports (around lines 17-20), update to:

```typescript
import type { Metadata, Viewport } from "next";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0a0a",
};

export const metadata: Metadata = {
  title: "CodeAnywhere",
  description: "A web GUI for Claude Code",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "CodeAnywhere",
  },
  icons: {
    apple: "/icons/icon-192.png",
  },
};
```

Note: In Next.js 16, `viewport` and `themeColor` must be exported separately from `metadata` — they are no longer properties of the `Metadata` type.

- [ ] **Step 2: Verify metadata renders correctly**

Run: `npm run dev`
Open browser DevTools → Elements → check `<head>` for manifest link, theme-color, apple-mobile-web-app-capable.

- [ ] **Step 3: Commit**

```bash
git add src/app/layout.tsx
git commit -m "feat(pwa): add PWA metadata to layout head"
```

---

### Task 20: Install and configure serwist Service Worker

**Files:**
- Modify: `package.json` — add serwist deps
- Modify: `next.config.ts` — add withSerwist wrapper
- Create: `src/app/sw.ts` — Service Worker source

- [ ] **Step 1: Install serwist packages**

```bash
npm install @serwist/next serwist
```

- [ ] **Step 2: Create `src/app/sw.ts`**

```typescript
// src/app/sw.ts
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope & typeof globalThis;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache.filter(
    // Exclude SSE/chat API from caching to prevent buffering issues
    (entry) => {
      const url = entry.urlPattern;
      if (url instanceof RegExp) {
        return !url.test("/api/chat");
      }
      return true;
    }
  ),
});

serwist.addEventListeners();
```

- [ ] **Step 3: Update `next.config.ts`**

```typescript
import type { NextConfig } from "next";
import { createRequire } from "module";
import withSerwistInit from "@serwist/next";

const require = createRequire(import.meta.url);
const pkg = require("./package.json");

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {
  output: "standalone",
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
  serverExternalPackages: ["better-sqlite3"],
};

export default withSerwist(nextConfig);
```

Note: Uses `createRequire` to import `package.json`, matching the existing code style in this project.

- [ ] **Step 4: Add `public/sw.js` to `.gitignore`**

The Service Worker is compiled at build time, so the output should be gitignored:

```
# Add to .gitignore:
public/sw.js
public/swe-worker-*.js
```

- [ ] **Step 5: Verify build with Service Worker**

```bash
npm run build
```
Expected: Build succeeds, `public/sw.js` is generated

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json next.config.ts src/app/sw.ts .gitignore
git commit -m "feat(pwa): add serwist Service Worker with caching strategies"
```

---

### Task 21: Add PWA install prompt

**Files:**
- Create: `src/hooks/usePWAInstall.ts`
- Modify: `src/components/layout/Header.tsx` — add install button

- [ ] **Step 1: Create `src/hooks/usePWAInstall.ts`**

```typescript
// src/hooks/usePWAInstall.ts
"use client";

import { useState, useEffect, useCallback } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function usePWAInstall() {
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    // Check if already installed (standalone mode)
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setIsInstalled(true);
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const install = useCallback(async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") {
      setIsInstalled(true);
    }
    setInstallPrompt(null);
  }, [installPrompt]);

  return {
    canInstall: !!installPrompt && !isInstalled,
    isInstalled,
    install,
  };
}
```

- [ ] **Step 2: Add install button to `Header.tsx`**

Add a small "Install" button to the header that only appears when `canInstall` is true:

```tsx
import { usePWAInstall } from "@/hooks/usePWAInstall";
// Inside Header component:
const { canInstall, install } = usePWAInstall();
// In the render:
{canInstall && (
  <button onClick={install} className="text-xs px-2 py-1 rounded border">
    Install
  </button>
)}
```

- [ ] **Step 3: Commit**

```bash
git add src/hooks/usePWAInstall.ts src/components/layout/Header.tsx
git commit -m "feat(pwa): add PWA install prompt hook and header button"
```

---

## Chunk 5: Phase 4 — Responsive UI

### Task 22: Add mobile viewport and safe area support

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Add safe area CSS variables**

Add to the top of `globals.css`:

```css
/* Safe area insets for notched devices */
:root {
  --safe-area-top: env(safe-area-inset-top, 0px);
  --safe-area-bottom: env(safe-area-inset-bottom, 0px);
  --safe-area-left: env(safe-area-inset-left, 0px);
  --safe-area-right: env(safe-area-inset-right, 0px);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(responsive): add safe area CSS variables for notched devices"
```

---

### Task 23: Create MobileDrawer component

**Files:**
- Create: `src/components/layout/MobileDrawer.tsx`

- [ ] **Step 1: Create `src/components/layout/MobileDrawer.tsx`**

```tsx
// src/components/layout/MobileDrawer.tsx
"use client";

import { useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";

interface MobileDrawerProps {
  open: boolean;
  onClose: () => void;
  side?: "left" | "right" | "bottom";
  children: React.ReactNode;
}

export function MobileDrawer({
  open,
  onClose,
  side = "left",
  children,
}: MobileDrawerProps) {
  // Close on escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (open) document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Prevent body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const slideDirection = {
    left: { initial: { x: "-100%" }, animate: { x: 0 }, exit: { x: "-100%" } },
    right: { initial: { x: "100%" }, animate: { x: 0 }, exit: { x: "100%" } },
    bottom: { initial: { y: "100%" }, animate: { y: 0 }, exit: { y: "100%" } },
  }[side];

  const positionClass = {
    left: "inset-y-0 left-0 w-80 max-w-[85vw]",
    right: "inset-y-0 right-0 w-80 max-w-[85vw]",
    bottom: "inset-x-0 bottom-0 max-h-[80vh] rounded-t-2xl",
  }[side];

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-40 bg-black/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          {/* Drawer */}
          <motion.div
            className={`fixed z-50 bg-background shadow-xl ${positionClass}`}
            initial={slideDirection.initial}
            animate={slideDirection.animate}
            exit={slideDirection.exit}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
          >
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/layout/MobileDrawer.tsx
git commit -m "feat(responsive): add MobileDrawer component with slide animation"
```

---

### Task 24: Add hamburger button to Header

**Files:**
- Modify: `src/components/layout/Header.tsx`

Note: This must be done BEFORE Task 25 (AppShell responsive), because AppShell will pass `onOpenDrawer` to Header.

- [ ] **Step 1: Add hamburger menu button**

```tsx
interface HeaderProps {
  onOpenDrawer?: () => void;
}

export default function Header({ onOpenDrawer }: HeaderProps) {
  // In render, add at the start:
  {onOpenDrawer && (
    <button
      onClick={onOpenDrawer}
      className="mr-2 p-2 rounded-md hover:bg-accent md:hidden"
      aria-label="Open menu"
    >
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 5h14M3 10h14M3 15h14" />
      </svg>
    </button>
  )}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/layout/Header.tsx
git commit -m "feat(responsive): add hamburger menu button to Header"
```

---

### Task 25: Make AppShell responsive with mobile drawer

**Files:**
- Modify: `src/components/layout/AppShell.tsx`

- [ ] **Step 1: Add mobile breakpoint detection**

AppShell already has `LG_BREAKPOINT = 1024` with `matchMedia`. Extend this to also detect mobile (< 768px):

```typescript
const MD_BREAKPOINT = 768;

// Add mobile state
const [isMobile, setIsMobile] = useState(false);
const [drawerOpen, setDrawerOpen] = useState(false);

useEffect(() => {
  const mql = window.matchMedia(`(max-width: ${MD_BREAKPOINT - 1}px)`);
  setIsMobile(mql.matches);
  const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
  mql.addEventListener("change", handler);
  return () => mql.removeEventListener("change", handler);
}, []);
```

- [ ] **Step 2: Wrap NavRail + ChatListPanel in MobileDrawer for mobile**

```tsx
import { MobileDrawer } from "./MobileDrawer";

// In render:
{isMobile ? (
  <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} side="left">
    <div className="flex h-full">
      <NavRail />
      <ChatListPanel />
    </div>
  </MobileDrawer>
) : (
  <>
    <NavRail />
    <ChatListPanel />
  </>
)}
```

- [ ] **Step 3: Pass `onOpenDrawer` to Header for hamburger button**

```tsx
<Header onOpenDrawer={isMobile ? () => setDrawerOpen(true) : undefined} />
```

- [ ] **Step 4: Wrap RightPanel in MobileDrawer for mobile**

```tsx
{isMobile ? (
  <MobileDrawer open={rightPanelOpen} onClose={() => setRightPanelOpen(false)} side="bottom">
    <RightPanel />
  </MobileDrawer>
) : (
  showRightPanel && <RightPanel />
)}
```

- [ ] **Step 5: Verify on desktop and mobile viewport**

Run: `npm run dev`
- Desktop (> 1024px): three-column layout unchanged
- Mobile (< 768px): single column, hamburger shows drawer

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/AppShell.tsx
git commit -m "feat(responsive): make AppShell responsive with mobile drawer"
```

---

### Task 26: Make MessageInput touch-friendly

**Files:**
- Modify: `src/components/chat/MessageInput.tsx`

- [ ] **Step 1: Increase touch targets**

Add mobile-specific padding and sizing:

```tsx
// Add to the main container:
className="... pb-[var(--safe-area-bottom)]"

// Add to the submit button:
className="... min-h-[44px] min-w-[44px]"

// Add to the textarea wrapper:
className="... md:text-sm text-base"  // Prevents iOS zoom on focus
```

- [ ] **Step 2: Commit**

```bash
git add src/components/chat/MessageInput.tsx
git commit -m "feat(responsive): increase touch targets on MessageInput"
```

---

### Task 27: Make code blocks horizontally scrollable

**Files:**
- Modify: `src/components/chat/CodeBlock.tsx` (or the relevant code block component)

- [ ] **Step 1: Add horizontal scroll to code blocks**

Wrap the code content in a container with `overflow-x: auto`:

```tsx
<div className="overflow-x-auto max-w-full">
  <pre className="...">
    <code>{content}</code>
  </pre>
</div>
```

Also ensure the container doesn't exceed viewport width on mobile:

```css
/* In globals.css or inline */
pre {
  max-width: calc(100vw - 2rem);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/chat/CodeBlock.tsx
git commit -m "feat(responsive): add horizontal scroll to code blocks on mobile"
```

---

### Task 28: Responsive fine-tuning and integration test

**Files:**
- Modify: Various components as needed

- [ ] **Step 1: Test all breakpoints**

Run: `npm run dev`

Test with browser DevTools responsive mode:
- **375px** (iPhone SE): Single column, drawer works, input at bottom
- **768px** (iPad): Two columns, right panel collapsed
- **1280px** (Desktop): Three columns, full layout

- [ ] **Step 2: Fix any overflow or layout issues**

Common issues to check:
- Long file paths or code lines not wrapping/scrolling
- Buttons too small on touch devices
- Drawer not closing after navigation
- Safe area padding on notched devices

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix(responsive): fine-tune layout and fix overflow issues across breakpoints"
```

---

## Chunk 6: Phase 5 — Docker Deployment

### Task 29: Create Dockerfile

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

- [ ] **Step 1: Create `.dockerignore`**

```
node_modules
.next
release
dist-electron
.git
*.md
docs
src/__tests__
```

- [ ] **Step 2: Create `Dockerfile`**

```dockerfile
# Stage 1: Dependencies
FROM node:20-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# Stage 2: Build
FROM node:20-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Stage 3: Runner
FROM node:20-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME="0.0.0.0"
ENV PORT=3000

# Install system dependencies for Claude Code CLI
RUN apt-get update && apt-get install -y \
    git \
    bash \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Copy standalone build output
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Copy better-sqlite3 native addon (already compiled in deps stage for same OS)
COPY --from=deps /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=deps /app/node_modules/bindings ./node_modules/bindings
COPY --from=deps /app/node_modules/file-uri-to-path ./node_modules/file-uri-to-path
COPY --from=deps /app/node_modules/node-addon-api ./node_modules/node-addon-api

EXPOSE 3000

CMD ["node", "server.js"]
```

Note: All stages use `node:20-slim` (same base image), so the native addon compiled in `deps` is binary-compatible with `runner`. No rebuild needed. Build tools (`python3`, `make`, `g++`) are only installed in the `deps` stage.

- [ ] **Step 3: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "feat(docker): add multi-stage Dockerfile for production deployment"
```

---

### Task 30: Create docker-compose.yml

**Files:**
- Create: `docker-compose.yml`

- [ ] **Step 1: Create `docker-compose.yml`**

```yaml
services:
  codeanywhere:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - codeanywhere-data:/root/.codeanywhere
      - claude-config:/root/.claude
      # Mount your project directories for Claude Code to access:
      # - /path/to/your/projects:/workspace
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - AUTH_TOKEN=${AUTH_TOKEN}
    restart: unless-stopped

volumes:
  codeanywhere-data:
  claude-config:
```

- [ ] **Step 2: Create `.env.example`**

```bash
# .env.example
ANTHROPIC_API_KEY=your-api-key-here
AUTH_TOKEN=your-secret-access-token
```

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml .env.example
git commit -m "feat(docker): add docker-compose with volume mounts and env config"
```

---

### Task 31: Test Docker build

- [ ] **Step 1: Build Docker image**

```bash
docker build -t codeanywhere:dev .
```
Expected: Build completes without errors

- [ ] **Step 2: Test container startup**

```bash
docker run --rm -p 3000:3000 \
  -e ANTHROPIC_API_KEY=test \
  -e AUTH_TOKEN=test123 \
  codeanywhere:dev
```
Expected: Server starts on port 3000, accessible via browser

- [ ] **Step 3: Test with docker-compose**

```bash
docker compose up --build
```
Expected: Service starts and is accessible at http://localhost:3000

- [ ] **Step 4: Fix any build issues and commit**

```bash
git add -A
git commit -m "fix(docker): resolve build issues from integration test"
```

---

### Task 32: Final integration verification

- [ ] **Step 1: Clean build test**

```bash
rm -rf .next node_modules
npm install
npm run build
npm run start
```
Expected: App starts on port 3000, all features work

- [ ] **Step 2: Verify auth flow**

Set `AUTH_TOKEN=test123` in `.env.local`:
- Open http://localhost:3000 → redirected to /login
- Enter "test123" → redirected to chat
- Open DevTools Network → all API calls include Authorization header

- [ ] **Step 3: Verify PWA**

Open Chrome DevTools → Application tab:
- Manifest loads correctly
- Service Worker registers
- "Install" button appears in header
- Lighthouse PWA audit passes basic checks

- [ ] **Step 4: Verify responsive layout**

Open DevTools responsive mode:
- 375px: single column, hamburger menu, drawer navigation
- 768px: two columns
- 1280px: three columns

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: complete CodeAnywhere PWA migration — all phases verified"
```

---

## Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| Phase 0 | 1-4 | Security: auth middleware, login page, authFetch wrapper |
| Phase 1 | 6-10 (incl. 9, 9b, 9c) | Brand: rename CodePilot → CodeAnywhere across 21+ files |
| Phase 2 | 11-17 | De-Electron: remove Electron layer, clean deps, update CI |
| Phase 3 | 18-21 | PWA: manifest, Service Worker, install prompt |
| Phase 4 | 22-28 (24/25 swapped) | Responsive: mobile drawer, breakpoints, touch targets |
| Phase 5 | 29-32 | Docker: Dockerfile, compose, integration test |
