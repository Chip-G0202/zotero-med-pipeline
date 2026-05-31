# MCP Readiness Contract

本文档定义 Stage 2 / Stage 3 的 MCP 就绪检查契约。

## 功能 Gate（所有平台通用）

Stage 2 / 3 进入的唯一功能 gate 是：**Zotero MCP `get_collections` JSON-RPC probe 成功**。

- 进程存在仅作为诊断信号，不是 gate。
- MCP readiness probe URL：`process.env.ZOTERO_MCP_URL || process.env.MCP_URL || "http://127.0.0.1:23120/mcp"`
- Probe 使用 JSON-RPC `get_collections` 方法。

## 平台检测与启动

| 操作 | Windows | macOS | Linux |
|------|---------|-------|-------|
| 检测 Zotero 进程 | `tasklist` + `Get-Process` via pwsh | `ps -A -o comm=` | `ps -A -o comm=` |
| 启动 Zotero | `powershell.exe Start-Process` / `schtasks` | `open -a Zotero` | `spawn(ZOTERO_EXE)` |

- `schtasks` / `powershell.exe` / `tasklist` / `cmd.exe` / `Start-Process` 仅在 win32 代码路径中调用。
- macOS 必须使用 `open` / `ps` 等效命令，不能调用 Windows-only 命令。
- `ZOTERO_EXTERNAL_LAUNCHER=desktop_commander` 是 Windows-only 配置。macOS / Linux 不设置此值。

## 默认可执行文件路径

- `runtime_config.mjs` 按平台解析 `zoteroExe`：
  - darwin → `/Applications/Zotero.app/Contents/MacOS/zotero`
  - win32 → `zotero.exe`
  - linux → `zotero`（从 PATH 查找）
- `ZOTERO_EXE` 环境变量在所有平台上优先级最高。
- 如果可执行文件解析失败，脚本必须在 MCP 访问前停止并报告 `ZOTERO_EXE` 指导。

## Readiness-Only 模式

- 在 `ZOTERO_EXTERNAL_LAUNCHER=desktop_commander` 模式下，Stage2/3 helper 仅执行 MCP readiness check，不得尝试本地 `pwsh`、`tasklist`、`Get-Process`、`Start-Process` 或 Node spawn fallback。

## 失败处理

- 如果 preflight 失败，脚本必须在 `run_report.json` 中标记 stage failure，不得声称 writeback/backfill 成功。
- 如果 MCP 在外部启动器交接后仍未就绪：Stage2/3 必须以 `MCP_NOT_READY_AFTER_EXTERNAL_LAUNCHER` 停止。
- 陈旧的 `mcp_writeback_summary.json` 和 `abc_translation_backfill.json` 不得被视为当前运行的成功 artifacts。

## Stale Artifact 保护

- `inspectArtifact` 比较 artifact `mtime` 与 `stageStartedAt`。如果 `mtime < stageStartedAt`，artifact 标记为 `stale: true, currentRun: false`。
- 每份报告包含 `runId` 用于跨运行 artifact 关联。

## Agent/自动化启动顺序（Windows + Desktop Commander）

仅在 Windows 且 Desktop Commander 可用时：

1. Agent tool `mcp__desktop_commander__.start_process` 运行 `schtasks /Run /TN StartZoteroForCodexOnly`
2. 等待 3000ms
3. 设置 `ZOTERO_EXTERNAL_LAUNCHER=desktop_commander`
4. 运行 `node --env-file=.env tools/run_zotero_literature_filter.mjs`

独立 cron/本地自动化可在 Desktop Commander 不可用时使用本地 shell fallback，仅限相同的 `schtasks /Run /TN StartZoteroForCodexOnly` 命令。

详见 `tools/lib/ensure_zotero_mcp_ready.mjs`（probe 实现）。
