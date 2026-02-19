<img src="docs/icon-readme.png" width="32" height="32" alt="CodeAnywhere" style="vertical-align: middle; margin-right: 8px;" /> CodeAnywhere
===

**A web GUI for Claude Code** -- chat, code, and manage projects through a polished visual interface accessible from any browser, including mobile devices.

[![GitHub release](https://img.shields.io/github/v/release/op7418/CodeAnywhere)](https://github.com/op7418/CodeAnywhere/releases)
[![Platform](https://img.shields.io/badge/platform-Web%20%7C%20Docker%20%7C%20PWA-blue)](https://github.com/op7418/CodeAnywhere/releases)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[中文文档](./README_CN.md) | [日本語](./README_JA.md)

---

## Features

- **Conversational coding** -- Stream responses from Claude in real time with full Markdown rendering, syntax-highlighted code blocks, and tool-call visualization.
- **Session management** -- Create, rename, archive, and resume chat sessions. Conversations are persisted locally in SQLite so nothing is lost between restarts.
- **Project-aware context** -- Pick a working directory per session. The right panel shows a live file tree and file previews so you always know what Claude is looking at.
- **Resizable panels** -- Drag the edges of the chat list and right panel to adjust their width. Your preferred sizes are saved across sessions.
- **File & image attachments** -- Attach files and images directly in the chat input. Images are sent as multimodal vision content for Claude to analyze.
- **Permission controls** -- Approve, deny, or auto-allow tool use on a per-action basis. Choose between permission modes to match your comfort level.
- **Multiple interaction modes** -- Switch between *Code*, *Plan*, and *Ask* modes to control how Claude behaves in each session.
- **Model selector** -- Switch between Claude models (Opus, Sonnet, Haiku) mid-conversation.
- **MCP server management** -- Add, configure, and remove Model Context Protocol servers directly from the Extensions page. Supports `stdio`, `sse`, and `http` transport types.
- **Custom skills** -- Define reusable prompt-based skills (global or per-project) that can be invoked as slash commands during chat.
- **Settings editor** -- Visual and JSON editors for your `~/.claude/settings.json`, including permissions and environment variables.
- **Token usage tracking** -- See input/output token counts and estimated cost after every assistant response.
- **PWA install** -- Install to your home screen on mobile or desktop for a native-like experience.
- **Dark / Light theme** -- One-click theme toggle in the navigation rail.
- **Slash commands** -- Built-in commands like `/help`, `/clear`, `/cost`, `/compact`, `/doctor`, `/review`, and more.
- **Token-based auth** -- Set `AUTH_TOKEN` to protect your instance when exposed over a network.

---

## Screenshots

![CodeAnywhere](docs/screenshot.png)

---

## Prerequisites

> **Important**: CodeAnywhere calls the Claude Code Agent SDK under the hood. Make sure `claude` is available on your `PATH` and that you have authenticated (`claude login`) before launching the app.

| Requirement | Minimum version |
|---|---|
| **Node.js** | 18+ |
| **Claude Code CLI** | Installed and authenticated (`claude --version` should work) |
| **npm** | 9+ (ships with Node 18) |

---

## Quick Start

```bash
# Clone the repository
git clone https://github.com/op7418/CodeAnywhere.git
cd CodeAnywhere

# Install dependencies
npm install

# Start in development mode
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

---

## Deploy

### Docker (recommended for self-hosting)

```bash
# Copy and configure environment
cp .env.example .env
# Set AUTH_TOKEN in .env to protect your instance

# Start with Docker Compose
docker compose up -d
```

The app will be available at `http://localhost:3000`.

### Standalone Node.js

```bash
npm run build
npm run start
```

### Environment Variables

| Variable | Description | Default |
|---|---|---|
| `AUTH_TOKEN` | Bearer token required to access the app. Leave unset to disable auth (local-only use). | unset |
| `PORT` | HTTP port | `3000` |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | [Next.js 16](https://nextjs.org/) (App Router, standalone) |
| PWA | Service Worker + Web App Manifest |
| UI components | [Radix UI](https://www.radix-ui.com/) + [shadcn/ui](https://ui.shadcn.com/) |
| Styling | [Tailwind CSS 4](https://tailwindcss.com/) |
| Animation | [Motion](https://motion.dev/) |
| AI integration | [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) |
| Database | [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) (embedded, per-user) |
| Markdown | react-markdown + remark-gfm + rehype-raw + [Shiki](https://shiki.style/) |
| Streaming | Server-Sent Events |
| Icons | [Hugeicons](https://hugeicons.com/) + [Lucide](https://lucide.dev/) |
| Deployment | [Docker](https://www.docker.com/) |
| CI/CD | [GitHub Actions](https://github.com/features/actions) |

---

## Project Structure

```
codeanywhere/
├── .github/workflows/      # CI/CD: web build + Docker
├── public/
│   ├── manifest.json        # PWA Web App Manifest
│   ├── sw.js                # Service Worker
│   └── icons/               # PWA icons
├── src/
│   ├── app/                 # Next.js App Router pages & API routes
│   │   ├── login/           # Token-based login page
│   │   ├── chat/            # New-chat page & [id] session page
│   │   ├── extensions/      # Skills + MCP server management
│   │   ├── settings/        # Settings editor
│   │   └── api/             # REST + SSE endpoints
│   │       ├── chat/        # Sessions, messages, streaming, permissions
│   │       ├── files/       # File tree & preview
│   │       ├── plugins/     # Plugin & MCP CRUD
│   │       ├── settings/    # Settings read/write
│   │       ├── skills/      # Skill CRUD
│   │       └── tasks/       # Task tracking
│   ├── components/
│   │   ├── ai-elements/     # Message bubbles, code blocks, tool calls, etc.
│   │   ├── chat/            # ChatView, MessageList, MessageInput, streaming
│   │   ├── layout/          # AppShell, NavRail, Header, MobileDrawer, RightPanel
│   │   ├── plugins/         # MCP server list & editor
│   │   ├── project/         # FileTree, FilePreview, TaskList
│   │   ├── skills/          # SkillsManager, SkillEditor
│   │   └── ui/              # Radix-based primitives (button, dialog, tabs, ...)
│   ├── hooks/               # Custom React hooks
│   ├── lib/                 # Core logic
│   │   ├── auth.ts          # Token verification and client storage
│   │   ├── api-client.ts    # authFetch wrapper
│   │   ├── claude-client.ts # Agent SDK streaming wrapper
│   │   ├── db.ts            # SQLite schema, migrations, CRUD
│   │   ├── files.ts         # File system helpers
│   │   ├── permission-registry.ts  # Permission request/response bridge
│   │   └── utils.ts         # Shared utilities
│   ├── middleware.ts         # Auth middleware (route protection)
│   └── types/               # TypeScript interfaces & API contracts
├── Dockerfile
├── docker-compose.yml
├── package.json
└── tsconfig.json
```

---

## Development

```bash
# Run Next.js dev server
npm run dev

# Production build
npm run build

# Start production server
npm run start
```

### Notes

- Chat data is stored in `~/.codeanywhere/codeanywhere.db`. If a previous `~/.codepilot` directory exists, it is automatically migrated on first launch.
- The app uses WAL mode for SQLite, so concurrent reads are fast.
- The Service Worker caches static assets and shells the app for offline use. API routes are never cached.

---

## Contributing

Contributions are welcome. To get started:

1. Fork the repository and create a feature branch.
2. Install dependencies with `npm install`.
3. Run `npm run dev` to test your changes locally.
4. Make sure `npm run lint` passes before opening a pull request.
5. Open a PR against `main` with a clear description of what changed and why.

Please keep PRs focused -- one feature or fix per pull request.

---

## License

MIT
