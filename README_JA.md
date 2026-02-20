<img src="docs/icon-readme.png" width="32" height="32" alt="CodeAnywhere" style="vertical-align: middle; margin-right: 8px;" /> CodeAnywhere
===

**Claude Code の Web GUI クライアント** -- モバイルを含む任意のブラウザからアクセスできる、洗練されたビジュアルインターフェースを通じてチャット、コーディング、プロジェクト管理を行えます。

[![GitHub release](https://img.shields.io/github/v/release/op7418/CodeAnywhere)](https://github.com/op7418/CodeAnywhere/releases)
[![Platform](https://img.shields.io/badge/platform-Web%20%7C%20Docker%20%7C%20PWA-blue)](https://github.com/op7418/CodeAnywhere/releases)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[English](./README.md) | [中文文档](./README_CN.md)

---

## 機能

- **会話型コーディング** -- Claude からのレスポンスをリアルタイムでストリーミング受信します。完全な Markdown レンダリング、シンタックスハイライトされたコードブロック、ツール呼び出しの可視化に対応しています。
- **セッション管理** -- チャットセッションの作成、名前変更、アーカイブ、再開ができます。会話は SQLite にローカル保存されるため、再起動後もデータが失われません。
- **プロジェクト対応コンテキスト** -- セッションごとに作業ディレクトリを指定できます。右パネルにはライブファイルツリーとファイルプレビューが表示されるため、Claude が何を見ているかが常にわかります。
- **権限制御** -- ツール使用をアクション単位で承認、拒否、または自動許可できます。
- **複数の相互作用モード** -- *Code*、*Plan*、*Ask* モード間で切り替えて、各セッションで Claude の動作を制御できます。
- **モデルセレクター** -- 会話中に Claude モデル（Opus、Sonnet、Haiku）を切り替えられます。
- **MCP サーバー管理** -- Model Context Protocol サーバーをエクステンションページから直接追加、設定、削除できます。`stdio`、`sse`、`http` トランスポート型に対応しています。
- **カスタムスキル** -- スラッシュコマンドとして呼び出し可能な、再利用可能なプロンプトベースのスキルを定義できます。
- **設定エディター** -- `~/.claude/settings.json` のビジュアルエディターと JSON エディター。
- **トークン使用量追跡** -- アシスタントのレスポンスごとに入力/出力トークン数と推定コストが表示されます。
- **PWA インストール** -- モバイルまたはデスクトップのホーム画面に追加して、ネイティブアプリのような体験ができます。
- **ダーク / ライト テーマ** -- ナビゲーションレールのワンクリックでテーマを切り替えられます。
- **スラッシュコマンド** -- `/help`、`/clear`、`/cost`、`/compact`、`/doctor`、`/review` などの組み込みコマンドを使用できます。
- **トークン認証** -- `AUTH_TOKEN` を設定して、ネットワーク公開時にインスタンスを保護できます。

---

## スクリーンショット

![CodeAnywhere](docs/screenshot.png)

---

## 前提条件

> **重要**: CodeAnywhere は Claude Code Agent SDK を内部で呼び出します。アプリを起動する前に、`claude` が `PATH` で利用可能であることを確認し、認証済み (`claude login`) であることを確認してください。

| 要件 | 最小バージョン |
|---|---|
| **Node.js** | 18+ |
| **Claude Code CLI** | インストール済みおよび認証済み (`claude --version` が動作することを確認) |
| **npm** | 9+ (Node 18 に付属) |

---

## クイックスタート

```bash
# リポジトリのクローン
git clone https://github.com/op7418/CodeAnywhere.git
cd CodeAnywhere

# 依存関係のインストール
npm install

# 開発モードで起動
npm run dev
```

その後、[http://localhost:3000](http://localhost:3000) を開きます。

---

## デプロイ

### Docker（セルフホスティング推奨）

```bash
# 環境変数を設定
cp .env.example .env
# .env に AUTH_TOKEN を設定してインスタンスを保護

# Docker Compose で起動
docker compose up -d
```

アプリは `http://localhost:3000` で利用できます。

### スタンドアロン Node.js

```bash
npm run build
npm run start
```

### 環境変数

| 変数 | 説明 | デフォルト |
|---|---|---|
| `AUTH_TOKEN` | アプリへのアクセスに必要な Bearer トークン。未設定の場合は認証を無効化（ローカル専用）。 | 未設定 |
| `PORT` | HTTP ポート | `3000` |

---

## テックスタック

| レイヤー | テクノロジー |
|---|---|
| フレームワーク | [Next.js 16](https://nextjs.org/)（App Router、standalone） |
| PWA | Service Worker + Web App Manifest |
| UI コンポーネント | [Radix UI](https://www.radix-ui.com/) + [shadcn/ui](https://ui.shadcn.com/) |
| スタイリング | [Tailwind CSS 4](https://tailwindcss.com/) |
| アニメーション | [Motion](https://motion.dev/) |
| AI 統合 | [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) |
| データベース | [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)（組み込み、ユーザーごと） |
| Markdown | react-markdown + remark-gfm + rehype-raw + [Shiki](https://shiki.style/) |
| ストリーミング | Server-Sent Events |
| アイコン | [Hugeicons](https://hugeicons.com/) + [Lucide](https://lucide.dev/) |
| デプロイ | [Docker](https://www.docker.com/) |
| CI/CD | [GitHub Actions](https://github.com/features/actions) |

---

## プロジェクト構成

```
codeanywhere/
├── .github/workflows/      # CI/CD：Web ビルド + Docker
├── public/
│   ├── manifest.json        # PWA Web App Manifest
│   ├── sw.js                # Service Worker
│   └── icons/               # PWA アイコン
├── src/
│   ├── app/                 # Next.js App Router ページ＆ API ルート
│   │   ├── login/           # トークン認証ログインページ
│   │   ├── chat/            # 新規チャットページ＆ [id] セッションページ
│   │   ├── extensions/      # スキル＋ MCP サーバー管理
│   │   ├── settings/        # 設定エディター
│   │   └── api/             # REST ＋ SSE エンドポイント
│   │       ├── chat/        # セッション、メッセージ、ストリーミング、権限
│   │       ├── files/       # ファイルツリー＆プレビュー
│   │       ├── plugins/     # プラグイン＆ MCP CRUD
│   │       ├── settings/    # 設定の読み書き
│   │       ├── skills/      # スキル CRUD
│   │       └── tasks/       # タスク追跡
│   ├── components/
│   │   ├── ai-elements/     # メッセージバブル、コードブロック、ツール呼び出しなど
│   │   ├── chat/            # ChatView、MessageList、MessageInput、ストリーミング
│   │   ├── layout/          # AppShell、NavRail、Header、MobileDrawer、RightPanel
│   │   ├── plugins/         # MCP サーバーリスト＆エディター
│   │   ├── project/         # FileTree、FilePreview、TaskList
│   │   ├── skills/          # SkillsManager、SkillEditor
│   │   └── ui/              # Radix ベースのプリミティブ（button、dialog、tabs など）
│   ├── hooks/               # カスタム React フック
│   ├── lib/                 # コアロジック
│   │   ├── auth.ts          # トークン検証とクライアントストレージ
│   │   ├── api-client.ts    # authFetch ラッパー
│   │   ├── claude-client.ts # Agent SDK ストリーミングラッパー
│   │   ├── db.ts            # SQLite スキーマ、マイグレーション、CRUD
│   │   ├── files.ts         # ファイルシステムヘルパー
│   │   ├── permission-registry.ts  # 権限リクエスト/レスポンスブリッジ
│   │   └── utils.ts         # 共有ユーティリティ
│   ├── middleware.ts         # 認証ミドルウェア（ルート保護）
│   └── types/               # TypeScript インターフェース＆ API コントラクト
├── Dockerfile
├── docker-compose.yml
├── package.json
└── tsconfig.json
```

---

## 開発

```bash
# Next.js 開発サーバーを実行
npm run dev

# 本番環境ビルド
npm run build

# 本番サーバーを起動
npm run start
```

### メモ

- チャットデータは `~/.codeanywhere/codeanywhere.db` に保存されます。旧バージョンの `~/.codepilot` ディレクトリが存在する場合、初回起動時に自動的に移行されます。
- アプリは SQLite の WAL モードを使用するため、同時読み込みは高速です。
- Service Worker は静的アセットをキャッシュし、オフラインでのアクセスを可能にします。API ルートはキャッシュされません。

---

## 貢献

貢献を歓迎します。開始するには：

1. リポジトリをフォークしてフィーチャーブランチを作成します。
2. `npm install` で依存関係をインストールします。
3. `npm run dev` を実行して、変更をローカルでテストします。
4. プルリクエストを開く前に `npm run lint` が成功することを確認します。
5. 変更内容と理由を明確に説明した PR を `main` に対して開きます。

PR はフォーカスを保つようにしてください -- 1 つのフィーチャーまたは修正ごとに 1 つの PR を開いてください。

---

## ライセンス

MIT
