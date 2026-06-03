# 内部模块归属与 CLI Wrapper 收敛记录

本文档记录 v1.3 能力归属审计结果、唯一 owner 指定、CLI wrapper 收敛原则，以及后续删除/归档候选。

## 生成时间

- 日期：2026-05-31
- 范围：10 项核心能力的审计与收敛

---

## 1. 能力归属表

| 能力 | 唯一 Owner (lib) | CLI Wrapper | 当前状态 |
|------|-----------------|-------------|---------|
| MCP readiness | `tools/lib/ensure_zotero_mcp_ready.mjs` | `tools/check_zotero_mcp_ready.mjs` | ✅ 已收敛为 thin wrapper |
| Ollama readiness | `tools/lib/ensure_ollama_ready.mjs` | `tools/check_ollama_ready.mjs` | ✅ 已是 thin wrapper |
| workbook reader | `tools/lib/review_workbook_reader.mjs` | 无 | 独立 lib 模块 |
| writeback / dedupe | `tools/lib/writeback_support.mjs` | `tools/mcp_bulk_writeback.mjs` | ⚠️ CLI 仍有内部重复，暂不处理 |
| writeback dry-run | `tools/lib/writeback_pool_dry_run_support.mjs` | `tools/dry_run_writeback_pool_dedupe.mjs` | 独立 lib 模块 |
| title translation | `tools/lib/title_translation_support.mjs` | 无 | 独立 lib 模块 |
| translation backfill | `tools/lib/translation_backfill_support.mjs` | `tools/mcp_translation_backfill.mjs` | ⚠️ CLI 仍有内部重复，暂不处理 |
| export / spreadsheet | `tools/lib/spreadsheet_adapter.mjs` | `tools/finalize_research_os_exports.mjs` | ⚠️ CLI 仍有内部重复，暂不处理 |
| preference learning | `tools/lib/preference_learning_support.mjs` | 无 | 独立 lib 模块 |
| feedback learning | `tools/lib/feedback_learning_support.mjs` | 无 | 独立 lib 模块 |
| runtime config | `tools/lib/runtime_config.mjs` | 无 | 独立 lib 模块 |
| schedule / interval gate | `tools/lib/schedule_support.mjs` | 无 | 独立 lib 模块 |
| triage policy | `tools/lib/workflow_classifier.mjs` | 无 | `triage_policy.mjs` 是兼容性 re-export |

---

## 2. CLI Wrapper 原则

### 稳定约定

- **CLI wrapper 调 lib owner**：CLI 脚本（`tools/*.mjs`）应只做入口编排，核心逻辑由 `tools/lib/*.mjs` 提供。
- **thin wrapper 标准**：CLI 不重复定义 lib 中已有的业务逻辑（如 probe、retry、格式化）。
- **参数兼容性**：CLI 的命令行参数和输出 JSON 格式在收敛过程中保持不变。

### 已完成的收敛

#### `check_zotero_mcp_ready.mjs` → thin wrapper

**变更前**：CLI 自定义了 `mcpProbe` 函数（约 12 行），与 lib 中的 probe 逻辑重复。

**变更后**：
- `ensure_zotero_mcp_ready.mjs` 新增 `defaultMcpProbe(mcpUrl)` 函数，提供默认的 MCP JSON-RPC probe
- `ensureZoteroMcpReady()` 不传 `mcpProbe` 时自动使用默认实现
- `check_zotero_mcp_ready.mjs` 不再定义自己的 `mcpProbe`，直接调用 `ensureZoteroMcpReady()`

**影响范围**：
- `check_zotero_mcp_ready.mjs`：移除约 12 行重复代码
- `ensure_zotero_mcp_ready.mjs`：新增约 16 行默认 probe 实现
- 行为不变：输出格式、CLI 参数、错误码均保持兼容

---

## 3. 暂不处理的高风险重复点

以下重复点在本轮审计中识别，但因涉及高风险模块（writeback、export、translation），暂不处理：

### 3.1 日期格式化函数重复

**涉及文件**：
- `tools/lib/runtime_config.mjs`：`yyMd`、`isoWeek`
- `tools/mcp_bulk_writeback.mjs`：`fmtDate`、`yyMd`、`isoWeek`
- `tools/mcp_translation_backfill.mjs`：`fmtDate`、`yyMd`、`isoWeek`
- `tools/finalize_research_os_exports.mjs`：`fmtDate`、`yyMd`、`isoWeek`、`weekNumber`、`weekLabel`
- `tools/lib/writeback_pool_dry_run_support.mjs`：`yyMd`、`isoWeek`、`weekLabel`
- `tools/lib/review_workbook_reader.mjs`：`weekNumber`、`isoWeek`、`yyMd`、`desktopWeekLabel`、`fmtDateRfc`

**建议**：统一使用 `runtime_config.mjs` 中的导出函数。需要修改 5+ 个文件，风险中等。

### 3.2 MCP 工具函数重复

**涉及文件**：
- `tools/mcp_bulk_writeback.mjs`：`mcpToolCall`、`wait`、`ensureMcpReady`
- `tools/mcp_translation_backfill.mjs`：`mcpToolCall`、`wait`、`ensureMcpReady`

**建议**：提取到 `tools/lib/mcp_client.mjs` 或类似模块。需要修改 Stage2/Stage3 核心脚本，风险较高。

### 3.3 `cleanJournalSource` 函数重复

**涉及文件**：
- `tools/lib/research_os_exports.mjs`（Python 版本）
- `tools/lib/spreadsheet_adapter.mjs`（JavaScript 版本）

**建议**：统一到 `spreadsheet_adapter.mjs`，Python 版本改为调用 JavaScript 输出。风险中等。

### 3.4 `parseDateNameToDate` 函数重复

**涉及文件**：
- `tools/mcp_bulk_writeback.mjs`
- `tools/mcp_translation_backfill.mjs`

**建议**：提取到 `tools/lib/date_utils.mjs` 或 `runtime_config.mjs`。风险低，但涉及 Stage2/Stage3。

---

## 4. 后续删除/归档候选

| 文件 | 当前状态 | 删除条件 |
|------|---------|---------|
| `tools/lib/triage_policy.mjs` | 兼容性 re-export | 确认所有调用方已改为直接 import `workflow_classifier.mjs` |
| `tools/generate_daily_xlsx.py` | Python 导出脚本 | 确认 JavaScript 导出路径完全覆盖 |
| `tools/check_med_query_learning_feedback.mjs` | 诊断脚本 | 确认功能已被 `feedback_learning_support.mjs` 覆盖 |
| `tools/check_previous_feedback_learning.mjs` | 诊断脚本 | 确认功能已被 `feedback_learning_support.mjs` 覆盖 |

---

## 5. 下一轮建议

### 低风险（可立即执行）

1. **统一日期格式化函数**：将 `fmtDate`、`yyMd`、`isoWeek`、`weekNumber`、`weekLabel` 统一到 `runtime_config.mjs`，其他文件改为 import
2. **提取 `parseDateNameToDate`**：提取到 `runtime_config.mjs` 或新模块

### 中风险（需谨慎评估）

3. **统一 MCP 工具函数**：提取 `mcpToolCall`、`wait` 到 `tools/lib/mcp_client.mjs`
4. **统一 `cleanJournalSource`**：JavaScript 版本作为唯一实现

### 高风险（建议分阶段执行）

5. **Stage2/Stage3 thin wrapper 收敛**：需要修改 `mcp_bulk_writeback.mjs` 和 `mcp_translation_backfill.mjs`
6. **Stage4 export 收敛**：需要修改 `finalize_research_os_exports.mjs`

---

## 6. 验证记录

### 本轮验证

- `node --check tools/check_zotero_mcp_ready.mjs`：✅ 通过
- `node --check tools/lib/ensure_zotero_mcp_ready.mjs`：✅ 通过
- `node --test tests/*.test.mjs`：✅ 60/60 通过

### 验证说明

- 本轮修改仅涉及 MCP readiness 的 thin wrapper 收敛
- 未访问外部服务（Zotero/MCP/Ollama）
- 未修改 CLI 参数兼容性
- 未删除任何文件
- 未改变输出 JSON 的字段含义
