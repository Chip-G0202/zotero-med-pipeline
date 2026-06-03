# Automation 更新说明

本目录包含自动化流程、配置、Prompt、测试与文档。  
完整安装、运行、配置说明和 FAQ，请见根目录 README：

- 中文：[`../README.md`](../README.md)
- English：[`../README.md#english-version`](../README.md#english-version)

## v1.4 更新内容

v1.4 的重点是把项目往“长期可运行、可维护、可复用”的方向继续打磨，而不是堆叠大量新功能。

### 新能力与治理改进

- **脚本入口与暴露面更清楚**：本次对 `tools/` 下的脚本做了更明确的分类，分为 official entry、internal stages、diagnostics、maintenance。普通用户日常只需关注主入口 `run_zotero_literature_filter.mjs`。
- **排障能力增强，新增只读诊断脚本**：新增 `check_ollama_ready.mjs`、`check_med_query_learning_feedback.mjs`、`check_previous_feedback_learning.mjs`，用于快速判断环境和学习链路是否正常。
- **Zotero 写回路径更安全**：Stage2 写回、翻译补翻、反馈修正等路径增加了统一的集合护栏逻辑，只允许在 `文献池` 子树和顶层 `值得精读` 范围内执行集合变更。
- **翻译补翻更可控**：翻译补翻阶段现在支持更明确的池扫描策略，包括扫描间隔、扫描窗口、扫描上限和启用开关。
- **运行报告更容易看懂**：orchestrator 的状态定义更完整，新增了更清晰的跳过、降级、失败语义，以及 `run_skip_report.json` 等运行产物。
- **公开发布治理更完整**：补充了新的面向开发者的暴露面文档，用于说明脚本角色、风险等级、能力归属和后续清理方向。

## English

This directory contains the automation workflow, configuration, prompts, tests, and documentation.  
For full installation, setup, execution, and FAQ, see the root README:

- [`../README.md`](../README.md)

### v1.4 Updates

v1.4 focuses on making the project more stable, easier to maintain, and easier to reuse as a public repository.

- Clarified script roles into official entry, internal stages, diagnostics, and maintenance.
- Added read-only diagnostic scripts for Ollama, current feedback learning, and previous feedback learning.
- Added stricter collection guard logic for Zotero write operations.
- Made translation backfill pool scanning more predictable with explicit interval, window, limit, and enable/disable controls.
- Improved orchestrator report semantics for skip, degrade, and failure states.
- Added public-facing docs for script exposure and module ownership.
