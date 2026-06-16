# Zotero Med Pipeline

一个基于 Codex 的科研文献自动化工作流，用于文献发现、筛选分级、Zotero 写回、标题翻译、偏好学习和报表生成。

MIT License | Codex workflow | v1.6 update

[快速开始](#快速开始) | [v1.6 更新](#v16-更新) | [目录结构](#目录结构) | [English](#english-version)

## 这是什么

Zotero Med Pipeline 是一个围绕 Codex、Zotero、Zotero MCP、RSS、PubMed/PMC、可配置筛选规则和报表导出构建的科研文献自动化工作流。

它适合需要长期跟踪新文献、整理检索结果、维护 Zotero 文献库、收集反馈并定期生成文献评价报告的科研者和研究团队。

> 它不会替代研究判断，而是负责重复性的第一轮筛选、归类和记录，把最终判断留给研究者。

## v1.6 更新

这次更新重点是让自动化更稳、更少误判、标签更干净。

- 收录更灵活：新增期刊白名单，指定新期刊可直接放行，不被期刊质量规则误拦。
- Zotero 写回更稳：大幅降低了批量写回、翻译回填时的 MCP 解析错误，自动化任务更少中断。
- 自动流程更可靠：前置检查更真实，失败阶段不会悄悄继续往下跑，避免“看起来跑完，其实没跑完”。
- 标签更干净：批量入库和历史条目维护时，会自动清理 `doi:`、`pmid:`、`pmcid:`、`url:`、`title:` 这类签名标签，减少噪声。
- 反馈更安全：你之前标记过的文献分级迁移，不会被后续新文献入库流程覆盖。


## 核心特色

| 特色 | 说明 |
| --- | --- |
| 四阶段自动化 | 检索、去重、分级、Zotero 写回、翻译和报表导出串成完整流程。 |
| 可配置分级 | 通过配置文件定义 A/B/C/D 筛选标准，让流程适配不同研究方向。 |
| 反馈学习 | 将用户反馈和筛选标准沉淀为可审计的偏好更新。 |
| Zotero MCP 集成 | 自动创建条目并归入日期、来源和分级收藏夹，同时清理 `doi:`/`pmid:`/`pmcid:`/`url:`/`title:` 等签名标签。 |
| 语义复审 | 结合 semantic search，为边界文献提供辅助复核信号。 |
| 4–5 星自动迁移 | `文献池` 中被标记为 4 星或 5 星的条目会自动迁移到顶层集合 `值得精读`。 |
| 日报与周期报告 | 输出便于人工复核、反馈和长期追踪的文献评价文件。 |

## 九个 Skill

| Skill | 作用 | 一句话说明 |
| --- | --- | --- |
| med-stage-orchestrator | 四阶段编排 | 保证 Stage1→2→3→4 顺序执行，上游失败则下游不跑 |
| med-entry-parallel | 并行入库 | RSS + PubMed/PMC 同时拉取，合并去重 |
| med-query-learning | 反馈学习 | 从 Excel 反馈和 docx 评价中学习，调整检索策略 |
| med-daily-triage | 每日分级 | 把文献分为 A/B/C/D 四级，生成隔日报 |
| med-zotero-bridge | Zotero 桥接 | 通过 MCP 把分级结果写回 Zotero，归入日期收藏夹 |
| med-monthly-synthesis | 月度综合 | 当月最后一次到期执行时汇总趋势，生成月报 |
| med-export-policy | 导出策略 | 统一管理报表导出方法、兜底路径和导出审计 |
| med-screening-standards | 筛选标准管理 | 维护 screening_standards.md 的更新、建议和同步 |
| med-semantic-grading | 语义复审 | 用 semantic search 对边界文献做辅助复核 |

## 目录结构

```text
├── README.md
├── LICENSE
├── .env.example
├── Automation/
│   ├── AGENTS.md
│   ├── PUBLIC_RELEASE_CHECKLIST.md
│   ├── .gitignore
│   ├── package.json
│   ├── package-lock.json
│   ├── config/
│   │   ├── rss_sources.json
│   │   ├── pubmed_pmc_search.json
│   │   ├── workflow_rules.json
│   │   ├── title_translation.config.json
│   │   ├── preference_learning.config.json
│   │   └── README.md
│   ├── prompts/
│   │   ├── title_translation.md
│   │   └── preference_learning.md
│   ├── docs/
│   │   ├── contracts/
│   │   ├── med-skill-alignment.md
│   │   ├── internal-script-inventory.md
│   │   └── internal-module-ownership.md
│   ├── tests/
│   └── tools/
│       ├── README.md
│       ├── run_zotero_literature_filter.mjs
│       ├── run_research_os_pipeline.mjs
│       ├── mcp_bulk_writeback.mjs
│       ├── mcp_translation_backfill.mjs
│       ├── finalize_research_os_exports.mjs
│       ├── check_zotero_mcp_ready.mjs
│       ├── check_ollama_ready.mjs
│       ├── check_med_query_learning_feedback.mjs
│       ├── check_previous_feedback_learning.mjs
│       ├── dry_run_writeback_pool_dedupe.mjs
│       ├── archive_history_by_feedback.mjs
│       ├── zotero_feedback_collection_corrections.mjs
│       └── lib/
│           ├── zotero_collection_guard.mjs
│           ├── writeback_support.mjs
│           ├── workflow_classifier.mjs
│           ├── triage_policy.mjs
│           ├── ensure_zotero_mcp_ready.mjs
│           ├── ensure_ollama_ready.mjs
│           ├── orchestrator_status.mjs
│           ├── schedule_support.mjs
│           ├── runtime_config.mjs
│           ├── pipeline_stage_support.mjs
│           ├── feedback_learning_support.mjs
│           ├── preference_learning_support.mjs
│           ├── screening_standards_file.mjs
│           ├── easyscholar_journal_quality_gate.mjs
│           ├── monthly_docx_report.mjs
│           ├── report_period_support.mjs
│           ├── title_translation_support.mjs
│           ├── translation_backfill_support.mjs
│           ├── spreadsheet_adapter.mjs
│           ├── review_workbook_reader.mjs
│           ├── zotero_semantic_search.mjs
│           └── ...
└── Skills/
    ├── VERSION.md
    ├── med-daily-triage/
    ├── med-entry-parallel/
    ├── med-export-policy/
    ├── med-query-learning/
    ├── med-screening-standards/
    ├── med-semantic-grading/
    ├── med-stage-orchestrator/
    ├── med-monthly-synthesis/
    └── med-zotero-bridge/
```

## 快速开始

### 1. 准备环境

- Node.js 18+
- PowerShell 7+
- Zotero Desktop
- Zotero MCP Plugin
- 可选：Ollama（用于语义复审）

### 2. 复制环境变量模板

```bash
copy .env.example .env
```

### 3. 配置本地参数

按项目说明填写 `.env` 中的：

- `TITLE_TRANSLATION_API_KEY`
- `PREFERENCE_LEARNING_API_KEY`
- `EASYSCHOLAR_SECRET_KEY`（可选；示例值为 `your_easyscholar_secret_key_here`）
- `EASYSCHOLAR_RATE_LIMIT_PER_SECOND`（可选；默认 `2`）
- `ZOTERO_MCP_URL`
- `ZOTERO_EXE`

EasyScholar key 只用于数据库检索来源文章的期刊质量筛选；不配置时不会筛除候选，只会在审计中记录该 gate 未启用。

### 4. 配置搜索源与筛选规则

按研究方向修改：

- `config/rss_sources.json`
- `config/pubmed_pmc_search.json`
- `screening_standards.md`
- `config/workflow_rules.json`

### 5. 运行主入口

```powershell
node tools/run_zotero_literature_filter.mjs
```

如果只想先跑 Stage1，不动 Zotero：

```powershell
node tools/run_zotero_literature_filter.mjs --stage1-only
```

### 6. 配置 Codex 自动化任务

你可以把整条管线配置成 Codex 自动化任务，系统会按计划自动运行，不需要每天手动触发。

默认行为：

- 每 2 天执行一次完整管线
- 不到 2 天自动跳过，并输出 skip 报告
- 月报在当月最后一次到期执行时生成

> 详细安装、配置、运行说明和自动化边界，请见 [`Automation/AGENTS.md`](Automation/AGENTS.md)。

## 支持项目

如果该项目帮到了你，可以请我喝杯咖啡，或者随手赞赏支持一下继续维护。
<img width="600" alt="c852b20ca26b99f8739606b28f92fed8" src="https://github.com/user-attachments/assets/a30216d0-9bde-4be5-8c9f-216b08ec3b98" />

## 付费安装配置与研究方向配置包

本项目本身开源，你可以自由下载、修改和自部署。付费服务主要面向希望节省配置时间、快速落地工作流、或希望为特定研究方向准备筛选配置的人。

需要可以联系 Email：g2269204031@163.com 小红书账号：278803432

### 定制安装配置服务

适合希望把工作流在本地跑起来，但不想自己处理环境和配置细节的用户。

- 依赖安装与运行环境检查
- `.env`、Zotero MCP、翻译模型和偏好学习配置
- Codex 自动化设置与首次运行排查

### 研究方向配置包

适合已经有明确研究方向，希望直接获得一套可复用配置模板的用户。

- RSS 与 PubMed/PMC 检索式设计
- A/B/C/D 筛选标准与分级规则配置
- 翻译、偏好学习和自动化运行清单配置

## 医学免责声明

本项目仅用于文献检索、证据整理与学术写作辅助，不构成医学建议、诊断、治疗方案或临床决策支持。

所有文献数据来自公开数据库，AI 分级结果仅供参考，最终判断请以专业知识和同行评议为准。

## License

MIT License. See [LICENSE](LICENSE).

---

# English Version

# Zotero Med Pipeline

A Codex-driven research literature automation workflow for discovery, triage, Zotero writeback, translation, feedback learning, and report generation.

MIT License | Codex workflow | v1.6 update

[Quick Start](#quick-start-1) | [v1.6 Updates](#v16-updates) | [License](#license-2)

## What is this?

Zotero Med Pipeline is a research literature automation workflow built around Codex, Zotero, Zotero MCP, RSS feeds, PubMed/PMC retrieval, configurable screening rules, and report export.

It is designed for researchers and teams who need to monitor new papers, filter noisy results, organize Zotero collections, collect feedback, and generate regular review reports.

> It does not replace research judgment. It automates the repetitive first pass and keeps the final decision with the researcher.

## v1.6 Updates

This update focuses on stability, cleaner automation, and cleaner metadata in Zotero.

- More flexible screening: a new journal allowlist lets selected journals bypass the journal-quality gate.
- More stable Zotero writeback: fewer MCP parse errors during batch writeback and translation backfill.
- More reliable automation: pre-stage checks are stricter, and failed stages no longer silently continue.
- Cleaner tags: signature-style tags such as `doi:`, `pmid:`, `pmcid:`, `url:`, and `title:` are cleaned during writeback and metadata maintenance.
- Safer feedback handling: prior feedback-driven collection migrations are not overwritten by later ingestion runs.

## Quick Start

1. Prepare Node.js 18+, PowerShell 7+, Zotero Desktop, Zotero MCP Plugin, and optional Ollama.
2. Copy `.env.example` to `.env` and fill in local values, including optional `EASYSCHOLAR_SECRET_KEY=your_easyscholar_secret_key_here` if you want journal-quality filtering for database-sourced papers.
3. Edit RSS, PubMed/PMC, grading, translation, and preference-learning configs under `config/`.
4. Edit `screening_standards.md`.
5. Run the main entrypoint:

```powershell
node tools/run_zotero_literature_filter.mjs
```

## Support the Project

If this project helps you, you can buy me a coffee or send a small appreciation to support continued maintenance.
<img width="600" alt="c852b20ca26b99f8739606b28f92fed8" src="https://github.com/user-attachments/assets/a30216d0-9bde-4be5-8c9f-216b08ec3b98" />

## Paid Setup & Research Direction Packs

The project is open source. Paid support is available for users who want faster setup or direction-specific configuration packs.

For paid support, contact Email: g2269204031@163.com Xiaohongshu: 278803432

### Custom installation & setup

Dependency checks, local environment configuration, Zotero MCP checks, Codex automation setup, and first-run troubleshooting.

### Research direction configuration pack

RSS and PubMed/PMC strategy design, A/B/C/D screening rules, translation and preference-learning configuration.

## License

MIT License. See [LICENSE](LICENSE).
