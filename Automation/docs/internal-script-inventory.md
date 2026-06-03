# 脚本入口清单

本文档用于盘点 `<YOUR_PROJECT_ROOT>\tools\` 下的脚本角色，方便后续 Codex 快速判断：
- 哪些是正式入口
- 哪些是内部阶段脚本
- 哪些是诊断 / 维护 / 待清理候选
- 哪些脚本可能写入 Zotero
- 哪些脚本默认需要 `dry-run` / `--apply`

## 分类原则

### official entry
- 用户或自动化可直接运行的主入口
- 负责启动完整 workflow

### internal stages
- 被 official entry 调用的阶段脚本
- 通常不建议普通用户单独运行

### diagnostics
- 只做检查、探测、就绪验证
- 不应修改业务状态

### maintenance
- 用于修复、校准、同步、归档、去重等运维动作
- 通常面向维护场景

### legacy / delete candidates
- 当前未见稳定主流程必要性
- 或已被更明确的 lib / 主流程能力覆盖

## 允许读取范围内的脚本清单

### tools/run_zotero_literature_filter.mjs
- **分类**: official entry
- **一句话说明**: 主流程编排入口，串联 Stage1 → MCP readiness → Stage2 → Stage3 → Stage4
- **是否允许普通用户直接运行**: 是
- **是否可能写入 Zotero**: 否（本脚本自身不直接写入，但会调度会写入 Zotero 的阶段）
- **是否默认需要 dry-run / --apply**: 默认不需要；支持 `--manual` / `--stage1-only` / `--date=`

### tools/run_research_os_pipeline.mjs
- **分类**: internal stages
- **一句话说明**: Stage1 入口，负责 RSS / PubMed / PMC 汇聚、分级、反馈学习和管线报告生成
- **是否允许普通用户直接运行**: 不建议
- **是否可能写入 Zotero**: 否
- **是否默认需要 dry-run / --apply**: 默认不需要

### tools/mcp_bulk_writeback.mjs
- **分类**: internal stages
- **一句话说明**: Stage2 入口，负责通过 Zotero MCP 执行条目创建、集合挂接、签名标签清理和星标迁移
- **是否允许普通用户直接运行**: 不建议
- **是否可能写入 Zotero**: 是
- **是否默认需要 dry-run / --apply**: 默认不需要额外开关即可写入

### tools/mcp_translation_backfill.mjs
- **分类**: internal stages
- **一句话说明**: Stage3 入口，负责 ABC 条目 shortTitle 翻译回填
- **是否允许普通用户直接运行**: 不建议
- **是否可能写入 Zotero**: 是（写入 item metadata）
- **是否默认需要 dry-run / --apply**: 默认不需要额外开关即可写入

### tools/finalize_research_os_exports.mjs
- **分类**: internal stages
- **一句话说明**: Stage4 入口，负责隔日报/双周报导出、运行报告汇总和导出审计
- **是否允许普通用户直接运行**: 不建议
- **是否可能写入 Zotero**: 否
- **是否默认需要 dry-run / --apply**: 默认不需要

### tools/check_zotero_mcp_ready.mjs
- **分类**: diagnostics
- **一句话说明**: 单独检查 Zotero MCP 是否可用，并返回探测结果
- **是否允许普通用户直接运行**: 是
- **是否可能写入 Zotero**: 否
- **是否默认需要 dry-run / --apply**: 不需要

### tools/check_ollama_ready.mjs
- **分类**: diagnostics
- **一句话说明**: 单独检查 Ollama 是否可用，并返回就绪结果
- **是否允许普通用户直接运行**: 是
- **是否可能写入 Zotero**: 否
- **是否默认需要 dry-run / --apply**: 不需要

### tools/lib/orchestrator_status.mjs
- **分类**: internal stages
- **一句话说明**: 提供 orchestrator report 构建、workflow status 推导和状态语义定义
- **是否允许普通用户直接运行**: 否（库模块）
- **是否可能写入 Zotero**: 否
- **是否默认需要 dry-run / --apply**: 不需要
- **Workflow Status 语义**:
  - `completed`: 全部 stage 成功完成
  - `completed_with_warnings`: 最终报表生成成功，但存在部分失败（如 Stage3 翻译部分失败）
  - `completed_stage1_only`: 仅 Stage1 完成（`--stage1-only` 模式）
  - `degraded_due_to_mcp_unavailable`: Stage1 成功但 MCP 就绪检查失败
  - `skipped` / `skipped_due_to_interval`: 间隔门控未达到，跳过本次执行
  - `failed_stage1`: Stage1 失败
  - `failed_stage2_writeback`: Stage2 写回失败
  - `failed_stage3_translation`: Stage3 翻译硬失败（非 partial_failed）
  - `failed_stage4_export`: Stage4 导出失败
  - `failed_due_to_config_or_dependency`: 配置或依赖失败，无法推导状态

### tools/lib/pipeline_stage_support.mjs
- **分类**: internal stages
- **一句话说明**: 提供写回候选和翻译回填输入的构建函数
- **是否允许普通用户直接运行**: 否（库模块）
- **是否可能写入 Zotero**: 否
- **是否默认需要 dry-run / --apply**: 不需要

### tools/lib/runtime_config.mjs
- **分类**: internal stages
- **一句话说明**: 提供统一的运行时路径、日期、平台和环境配置
- **是否允许普通用户直接运行**: 否（库模块）
- **是否可能写入 Zotero**: 否
- **是否默认需要 dry-run / --apply**: 不需要

### tools/lib/writeback_support.mjs
- **分类**: internal stages
- **一句话说明**: 提供 Zotero 写回过程中的并发控制、风险判断、集合挂接和标签清理能力
- **是否允许普通用户直接运行**: 否（库模块）
- **是否可能写入 Zotero**: 是（供 Stage2 使用）
- **是否默认需要 dry-run / --apply**: 不需要

### tools/lib/finalize_exports_support.mjs
- **分类**: internal stages
- **一句话说明**: 提供最终导出时的 payload 组装能力
- **是否允许普通用户直接运行**: 否（库模块）
- **是否可能写入 Zotero**: 否
- **是否默认需要 dry-run / --apply**: 不需要

### tools/lib/research_os_exports.mjs
- **分类**: internal stages
- **一句话说明**: 提供日报/周报相关的导出矩阵、脚本生成和导出辅助能力
- **是否允许普通用户直接运行**: 否（库模块）
- **是否可能写入 Zotero**: 否
- **是否默认需要 dry-run / --apply**: 不需要

### tools/lib/translation_backfill_support.mjs
- **分类**: internal stages
- **一句话说明**: 提供翻译回填并发控制、风险判断和批量回填逻辑
- **是否允许普通用户直接运行**: 否（库模块）
- **是否可能写入 Zotero**: 是（供 Stage3 使用）
- **是否默认需要 dry-run / --apply**: 不需要

## 当前结论

- **唯一推荐的 official entry**: `tools/run_zotero_literature_filter.mjs`
- **内部阶段主链路**: `run_research_os_pipeline.mjs` → `mcp_bulk_writeback.mjs` → `mcp_translation_backfill.mjs` → `finalize_research_os_exports.mjs`
- **当前明显诊断工具**: `check_zotero_mcp_ready.mjs`、`check_ollama_ready.mjs`

## 本轮整理后的暴露面结论

- `tools/README.md` 已补充脚本暴露面说明，明确 official entry / internal stages / diagnostics / maintenance / legacy 候选。
- 高风险维护类脚本已补充文件头提醒：非日常入口；涉及 Zotero 写入的脚本应优先 dry-run，只有显式 `--apply` 才执行真实变更；除非存在明确 contract，否则不应由主 workflow 直接调用。
- 本轮未移动文件，优先通过文档降低误运行风险。

## 已归档到 maintenance / legacy 候选的脚本

- `tools/archive_history_by_feedback.mjs`
  - **分类**: maintenance
  - **说明**: 历史反馈归档工具
- `tools/dry_run_writeback_pool_dedupe.mjs`
  - **分类**: maintenance / diagnostics
  - **说明**: 写回池去重 dry-run 检查
- `tools/zotero_feedback_collection_corrections.mjs`
  - **分类**: maintenance
  - **说明**: 集合级反馈修正工具
  - **风险提示**: 涉及 Zotero 写入时应默认 dry-run；仅在显式 `--apply` 时执行真实变更

## 已移除的 legacy 入口

- `tools/sync_zotero_collections_from_archive.mjs`
  - **移除原因**: 不在当前主流程中使用，归档集合同步语义已不适合作为默认暴露入口
- `tools/zotero_concurrency_calibration.mjs`
  - **移除原因**: 依赖已废弃的 isolated calibration 写入模式，该模式被 Zotero collection guard 阻断
- `tools/zotero_concurrency_diagnostic.mjs`
  - **移除原因**: 不在当前主流程中使用，且会调用 Stage2 写回路径，误运行风险高
- `tools/zotero_write_metadata_upper_bound_calibration.mjs`
  - **移除原因**: 不在当前主流程中使用，且直接执行 metadata 写入校准，不符合当前统一 guard 暴露面

## 后续建议

- 若后续需要进一步整理 `tools/`，优先采取文档标注 + 旧路径 shim 的方式，而不是直接重排目录。
- 如果未来确实需要移动 maintenance / diagnostics 脚本，旧路径 shim 应仅负责：
  1. 打印 deprecation notice；
  2. import / call 新路径；
  3. 保留原 CLI 参数透传；
  4. 不改变 exit code 语义。
