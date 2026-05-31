# Compatibility Contract

本文档定义跨平台兼容性和运行时要求契约。

## 运行时要求

- **Node.js** >= 18.0.0
- **PowerShell 7 (pwsh)** >= 7.0.0

## 平台特定规则

不同操作系统使用不同命令，但产生相同的功能行为：

| 操作 | Windows | macOS | Linux |
|------|---------|-------|-------|
| 启动 Zotero | `powershell.exe Start-Process` / `schtasks` | `open -a Zotero` | `spawn(ZOTERO_EXE)` |
| 检测 Zotero 进程 | `tasklist` + `Get-Process` via pwsh | `ps -A -o comm=` | `ps -A -o comm=` |
| 启动 Ollama | `powershell.exe Start-Process -WindowStyle Hidden ollama -ArgumentList "serve"` | `open -a Ollama` | spawn |

所有其他操作（MCP probe、RSS fetch、PubMed query、triage、dedup、writeback、translation、export）是平台无关的 Node.js 代码。

## 不能跨平台混用的命令

- `schtasks` / `powershell.exe` / `tasklist` / `cmd.exe` / `Start-Process` 仅在 win32 代码路径中调用
- macOS 必须使用 `open` / `ps` 等效命令
- `ZOTERO_EXTERNAL_LAUNCHER=desktop_commander` 是 Windows-only 配置，macOS / Linux 不设置此值

## Pwsh Gate

- 最低版本 `7.0.0`
- `7.0.0`、`7.4.x`、`7.6.2`、`7.7.x`、`8.x` 以及未来主版本 `>=7` 均可接受
- `5.1`、`6.x` 以及所有主版本 `<7` 不通过最低 gate
- 未知版本输出必须审计（`pwsh_version_unknown=true`，捕获原始输出），但不应自动视为硬失败

## Ollama Preflight

- 语义分级前，调用 `ensureOllamaReady()`（`tools/lib/ensure_ollama_ready.mjs`）
- 健康检查：`GET {ollamaUrl}/api/tags`
- 如已可达，立即返回（`started_now: false`）
- 如不可达，按平台启动 Ollama，然后轮询 `/api/tags`（最多 10 次，每次间隔 3 秒）
- 默认 Ollama URL：`http://127.0.0.1:11434`；通过 `OLLAMA_HOST` 环境变量覆盖
- 启动失败设置 `semanticGradingReport.skipped_reason = "ollama_unavailable"`，跳过语义分级，其他 stage 继续正常运行
- Embedding 模型不自动拉取；如缺失，报告差距并停止语义分级

## 语义复审资格

- 仅处理 **B** 和 **C** 条目
- **A** 条目不复审（已是最高等级）
- **D** 条目不复审（包括 `flags.uncertain=true` 的条目）
- C→D 语义降级**不自动采用**：`final_grade` 保持 C，`needs_human_review=true`
- 其他 1 级调整（C→B、B→A、B→C）自动采用
- 2+ 级差异保持 `rule_grade` 并标记 `needs_human_review=true`

## 无 package.json 约束

- 当前仓库没有提交的 `package.json` 和 lockfile
- 本地命令直接使用 Node 二进制运行
- 窄验证命令：`node --test tests/*.test.mjs`（如存在）
- 复现性依赖于文档化的运行时版本和 `.env.example`
