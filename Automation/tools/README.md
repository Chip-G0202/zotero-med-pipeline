# tools/ 目录暴露面说明

本目录用于存放 `zotero-med-pipeline` 的运行脚本与支持库。  
为降低误运行风险，脚本按以下方式分类：

## Official entry

- `run_zotero_literature_filter.mjs`
  - 当前唯一推荐的完整 workflow 入口。
  - 负责串联 Stage 1 → MCP readiness → Stage 2 → Stage 3 → Stage 4。
  - 日常 scheduled run / manual run 优先使用此脚本。

## Internal stages

以下脚本属于内部 stage 或导出阶段实现，不建议作为独立入口直接运行：

- `run_research_os_pipeline.mjs`
  - 现有 Stage 1/主流程实现主体，仍被 official entry 引用。
- `mcp_bulk_writeback.mjs`
  - Stage 2 Zotero 写回实现。
- `mcp_translation_backfill.mjs`
  - Stage 3 翻译补翻实现。
- `finalize_research_os_exports.mjs`
  - Stage 4 导出/汇总实现。

## Diagnostics

以下脚本用于只读诊断或状态检查：

- `check_zotero_mcp_ready.mjs`
  - MCP readiness 诊断入口。
  - 实际 owner 逻辑收敛在 `tools/lib/ensure_zotero_mcp_ready.mjs`。
- `check_ollama_ready.mjs`
  - 本地 Ollama 状态诊断。
- `check_med_query_learning_feedback.mjs`
  - 当日反馈学习诊断。
- `check_previous_feedback_learning.mjs`
  - 前一周期反馈学习诊断。

## Maintenance

以下脚本属于维护/修正/校准类工具，不是日常 workflow 入口。  
除非有明确 contract，不要从完整 workflow 中直接调用。

- `archive_history_by_feedback.mjs`
  - 历史反馈归档工具。
- `dry_run_writeback_pool_dedupe.mjs`
  - 写回池去重 dry-run 检查。
- `zotero_feedback_collection_corrections.mjs`
  - 集合级反馈修正工具。
  - 会涉及 Zotero 写入操作时，默认应 dry-run；仅在显式 `--apply` 时执行真实变更。

## Removed legacy entries

以下旧脚本不在当前主流程中使用，且与新的 Zotero MCP 集合 guard / 启动边界不再完全一致，已从 `tools/` 移除以降低误运行风险：

- `sync_zotero_collections_from_archive.mjs`
- `zotero_concurrency_calibration.mjs`
- `zotero_concurrency_diagnostic.mjs`
- `zotero_write_metadata_upper_bound_calibration.mjs`

以下诊断脚本仍保留，但不建议当作常规入口使用：

- `check_med_query_learning_feedback.mjs`
- `check_previous_feedback_learning.mjs`

## 补充说明

- 完整 ownership 与边界说明，请优先参考 `docs/internal-module-ownership.md`。
- 当前整理目标是降低误运行风险，不做大规模文件重排。
- 若后续确实需要移动 maintenance/diagnostics 脚本，应：
  1. 保留旧路径 shim；
  2. shim 仅负责打印 deprecation notice、透传参数、调用新路径；
  3. 不改变 exit code 语义。
