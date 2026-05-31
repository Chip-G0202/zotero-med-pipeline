# Workflow Contract

本文档定义 zotero-med-pipeline 的完整工作流编排契约。

## 唯一完整入口

```
node --env-file=.env tools/run_zotero_literature_filter.mjs
```

- 这是日常 scheduled run / manual run 的唯一推荐入口。
- 内部阶段脚本（`run_research_os_pipeline.mjs` 等）不作为独立完整入口运行。
- maintenance / correction / calibration 脚本不是日常入口。

## Stage 顺序

Stage 1 → MCP readiness → Stage 2 → Stage 3 → Stage 4

1. Stage 1 运行时不要求 MCP 就绪（RSS / PubMed 汇聚、分级、反馈学习）
2. MCP readiness check 在 Stage 1 完成后、Stage 2 之前执行
3. 只有 MCP readiness 通过后，Stage 2 / Stage 3 才可运行
4. Stage 4 依赖 Stage 2 / 3 成功 + 新鲜 artifacts

## 间隔门控

- 默认间隔：2 天（`RESEARCH_OS_RUN_INTERVAL_DAYS=2`）
- 强制覆盖：`FORCE_RESEARCH_OS_RUN=true` 或 `RESEARCH_OS_FORCE_RUN=true`
- 间隔未达到时：跳过所有 stage，输出 skip 字段（`skipped_due_to_interval`, `next_eligible_run_at`）
- 间隔门控使用 `Asia/Shanghai` 15:00 计划槽语义；48h 比较基于计划槽，非实际 start/end/Stage4 时间

## Stage Status 语义

定义于 `tools/lib/orchestrator_status.mjs`：

| Status | 含义 |
|--------|------|
| `completed` | 全部 stage 成功完成 |
| `completed_with_warnings` | 最终报表生成成功，但存在部分失败 |
| `completed_stage1_only` | 仅 Stage1 完成（`--stage1-only` 模式） |
| `degraded_due_to_mcp_unavailable` | Stage1 成功但 MCP 就绪检查失败 |
| `skipped` / `skipped_due_to_interval` | 间隔门控未达到，跳过本次执行 |
| `failed_stage1` | Stage1 失败 |
| `failed_stage2_writeback` | Stage2 写回失败 |
| `failed_stage3_translation` | Stage3 翻译硬失败 |
| `failed_stage4_export` | Stage4 导出失败 |
| `failed_due_to_config_or_dependency` | 配置或依赖失败 |

## Desktop Daily Review 数据源

- `desktop_daily_review_source.json` 必须只包含当天 Stage2 实际写入 Zotero 的条目（来自 `mcp_writeback_summary.writeback_items`），不得包含文献池去重跳过的重复条目。
- Stage 2 完成后，orchestrator 用 writeback itemKey 过滤 desktop source。
- Stage 2 失败/skip 时，desktop source 保持原始全量（保证有输出）。
- Stage 1 全量 ABC 是候选池，不是隔日报数据源。

## 内部阶段链路

`run_research_os_pipeline.mjs` → `mcp_bulk_writeback.mjs` → `mcp_translation_backfill.mjs` → `finalize_research_os_exports.mjs`

详见 `tools/README.md`（脚本入口分类）和 `docs/internal-script-inventory.md`（脚本盘点）。
