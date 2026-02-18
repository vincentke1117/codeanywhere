# CLAUDE.md

## Project Overview

CodeAnywhere — Claude Code 的 Web GUI 客户端，基于 Next.js (PWA)。

## Development Rules

**提交前必须详尽测试：**
- 每次提交代码前，必须在开发环境中充分测试所有改动的功能，确认无回归
- 涉及前端 UI 的改动需要实际启动应用验证（`npm run dev`）
- 涉及构建/打包的改动需要完整执行一次构建流程验证产物可用

**新增功能前必须详尽调研：**
- 新增功能前必须充分调研相关技术方案、API 兼容性、社区最佳实践
- 涉及第三方库需确认与现有依赖的兼容性
- 涉及 Claude Code SDK 需确认 SDK 实际支持的功能和调用方式
- 对不确定的技术点先做 POC 验证，不要直接在主代码中试错

## Build Notes

- `npm run dev` — 开发模式
- `npm run build` — 生产构建（standalone 输出）
- `npm run start` — 启动生产服务器
- Docker 部署：`docker compose up --build`
- 构建前清理 `rm -rf .next/` 可避免旧产物污染

## 发版纪律

**禁止自动发版**：不要在完成代码修改后自动执行 `git push` + `git tag` + `git push origin tag` 发版流程。必须等待用户明确指示"发版"、"发布"或类似确认后才能执行。代码提交（commit）可以正常进行，但推送和打 tag 必须由用户确认。
