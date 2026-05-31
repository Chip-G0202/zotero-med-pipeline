# Zotero Med Pipeline

一个基于 Codex、Zotero 和 Zotero MCP 的医学文献自动化工作流，用于文献发现、筛选分级、Zotero 写回、标题翻译、偏好学习和报表生成。

[English](#english)

## v1.3 update

v1.3 将项目整理为两个公开模块：

- `Automation/`: 自动化工作流代码、配置模板、prompt、测试和文档。
- `Skills/`: 工作流依赖的 Codex / agent skills，用于阶段编排、检索入口、分级、Zotero 写回、翻译补全、反馈学习和报表导出。

仓库根目录只保留 `README.md`、`LICENSE`、`Automation/` 和 `Skills/`，方便在 GitHub 上直接查看项目说明，并让 GitHub 正常识别 MIT license。

## 这是什么？

Zotero Med Pipeline 是一个面向科研人员的文献自动化管线。它把 RSS 订阅、PubMed/PMC 检索、去重、A/B/C/D 分级、Zotero 收藏夹写回、中文标题翻译和隔日报/双周报导出放进同一条可审计流程。

典型流程：

```text
RSS / PubMed-PMC -> merge + dedup -> A/B/C/D triage -> Zotero MCP writeback -> title translation -> workbook/report export
```

## 适合解决的问题

| 常见痛点 | 工作流做什么 |
| --- | --- |
| 每天手动翻期刊目录耗时 | RSS 和 PubMed/PMC 统一入口，自动收集候选文献 |
| 标题摘要筛选重复、主观、容易漏 | 使用可配置规则和语义复核输出 A/B/C/D 分级 |
| Zotero 收藏夹需要手动整理 | 通过 Zotero MCP 写回每日来源集合和等级集合 |
| 英文标题浏览效率低 | 对 A/B/C 文献执行标题翻译补全 |
| 反馈无法沉淀 | 从隔日报反馈和 `screening_standards.md` 中学习偏好，并保留审计 JSON |
| 周期性汇总麻烦 | 自动导出隔日报 workbook，并按周期生成双周汇总 |

## 核心特色

- **双入口检索**: RSS 与 PubMed/PMC 并行获取候选文献。
- **统一去重**: 按 DOI、PMID/PMCID、URL、规范化标题逐级去重。
- **A/B/C/D 分级**: 规则分级与语义复核结合，保留初始等级、语义等级和最终等级。
- **Zotero MCP 写回**: 不直接编辑 Zotero 数据库，只通过 MCP 工具写入和移动条目。
- **反馈学习**: 从用户在隔日报中的反馈和长期筛选标准中提取偏好证据。
- **可审计输出**: 关键阶段写入 JSON 报告，记录降级、跳过和失败原因。
- **公开发布结构**: 自动化代码与 skills 分离，便于复用、审查和二次开发。

## 目录结构

```text
Automation/
  AGENTS.md
  README.md
  .env.example
  package.json
  package-lock.json
  config/
  prompts/
  tools/
  tests/
  docs/

Skills/
  med-stage-orchestrator/
  med-query-learning/
  med-entry-parallel/
  med-daily-triage/
  med-zotero-bridge/
  med-semantic-grading/
  med-weekly-synthesis/
  med-export-policy/
  med-screening-standards/
```

## 快速开始

1. 安装 Node.js 18 或更新版本。
2. 安装 PowerShell 7 或更新版本。
3. 安装 Zotero Desktop，并确保 Zotero MCP 可用。
4. 在 Codex 中打开项目，工作目录切到 `Automation`。
5. 复制 `.env.example` 为 `.env`，填入本地配置。不要提交 `.env`。
6. 根据自己的研究方向修改 `Automation/config/` 中的公开模板。

运行主流程：

```powershell
cd Automation
node --env-file=.env tools/run_zotero_literature_filter.mjs
```

## 推荐给 Codex 的使用方式

在 Codex 中可以这样描述任务：

```text
读取 Automation/AGENTS.md，从 Automation 目录运行主工作流，按 Stage 1 到 Stage 4 汇报结果，并说明任何降级或失败原因。
```

主入口会按顺序执行：

1. Stage 1: RSS / PubMed-PMC 获取、合并、去重、分级和审计输出。
2. MCP readiness: 检查 Zotero MCP 是否可用。
3. Stage 2: 将 A/B/C 条目写回 Zotero。
4. Stage 3: 对写回条目补全标题翻译。
5. Stage 4: 导出用户可读的隔日报和周期汇总。

## 验证

基础本地检查：

```powershell
cd Automation
node --check tools/run_zotero_literature_filter.mjs
node --test tests/*.test.mjs
```

完整端到端运行依赖 Zotero、Zotero MCP、外部检索和本地 API 配置；公开仓库中的配置文件仅作为模板。

## 安全边界

- 不提交 `.env`、API key、token、日志、缓存、导出结果或 Zotero 数据库文件。
- PDF 获取不在自动化范围内，用户仍在 Zotero 中手动处理 PDF。
- 工作流通过 Zotero MCP 读写 Zotero，不直接编辑 `zotero.sqlite`。
- 公开配置中的研究方向、RSS 源和 PubMed 查询均应替换为你自己的本地值。

## 付费安装配置与研究方向配置包

本项目本身开源，你可以自由下载、修改和自部署。付费服务主要面向希望节省配置时间、快速落地工作流，或希望为特定研究方向准备筛选配置的人。

- **安装与首跑配置**: 依赖安装、`.env` 设置、Zotero MCP 检查、翻译和偏好学习配置、Codex 自动化设置、首跑问题排查。
- **研究方向配置包**: RSS 源选择、PubMed/PMC 查询设计、A/B/C/D 筛选规则、翻译设置、偏好学习设置和自动化检查清单。

## 致谢

- [Codex](https://github.com/openai/codex)
- [Zotero](https://www.zotero.org/)
- [Zotero MCP plugin](https://github.com/cookjohn/zotero-mcp)

## License

MIT License. See [LICENSE](LICENSE).

---

# English

# Zotero Med Pipeline

A Codex-driven medical literature automation workflow for discovery, triage, Zotero writeback, title translation, feedback learning, and report generation.

## v1.3 update

v1.3 reorganizes the project into two public modules:

- `Automation/`: workflow code, public configuration templates, prompts, tests, and documentation.
- `Skills/`: Codex / agent skills used by the workflow for orchestration, retrieval, triage, Zotero writeback, translation backfill, feedback learning, and report export.

The repository root intentionally contains only `README.md`, `LICENSE`, `Automation/`, and `Skills/` so GitHub can show the project overview and detect the MIT license cleanly.

## What is this?

Zotero Med Pipeline is a research literature automation pipeline for biomedical researchers. It combines RSS feeds, PubMed/PMC retrieval, deduplication, A/B/C/D grading, Zotero collection writeback, Chinese title translation, and recurring workbook/report export into one auditable workflow.

Typical flow:

```text
RSS / PubMed-PMC -> merge + dedup -> A/B/C/D triage -> Zotero MCP writeback -> title translation -> workbook/report export
```

## Pain Points & Solutions

| Pain point | What the workflow does |
| --- | --- |
| Manually scanning journals is slow | Collects RSS and PubMed/PMC results into one workflow |
| Title and abstract screening is repetitive | Uses configurable rules and semantic review to grade papers |
| Zotero collections require manual cleanup | Writes items into daily source and grade collections through Zotero MCP |
| English-only titles slow review | Backfills Chinese title translations for A/B/C items |
| User feedback is hard to preserve | Learns from review workbook feedback and long-lived screening standards |
| Periodic reports are tedious | Exports daily review workbooks and biweekly summaries |

## Core Features

- **Dual retrieval channels**: RSS and PubMed/PMC are handled in parallel.
- **Unified deduplication**: DOI, PMID/PMCID, URL, and normalized titles are used in priority order.
- **A/B/C/D grading**: Rule-based grading and semantic review are both auditable.
- **Zotero MCP writeback**: The workflow uses MCP tools and never edits the Zotero database directly.
- **Feedback learning**: Review feedback and `screening_standards.md` become traceable preference evidence.
- **Auditable outputs**: Stage reports record skip, degrade, and failure reasons.
- **Public release layout**: Automation code and skills are separated for easier reuse and review.

## Quick Start with Codex

1. Install Node.js 18 or newer.
2. Install PowerShell 7 or newer.
3. Install Zotero Desktop and make Zotero MCP available.
4. Open the project in Codex and use `Automation` as the working directory.
5. Copy `.env.example` to `.env` and fill in local values. Do not commit `.env`.
6. Adapt public templates under `Automation/config/` to your research direction.

Run the main workflow:

```powershell
cd Automation
node --env-file=.env tools/run_zotero_literature_filter.mjs
```

## Validation

```powershell
cd Automation
node --check tools/run_zotero_literature_filter.mjs
node --test tests/*.test.mjs
```

End-to-end execution depends on Zotero, Zotero MCP, external retrieval, and local API configuration. The public repository ships templates, not private runtime settings.

## License

MIT License. See [LICENSE](LICENSE).
