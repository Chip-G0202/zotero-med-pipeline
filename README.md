# Zotero Med Pipeline

一个基于 Codex 构建的科研文献自动化工作流，让 Zotero + AI 帮你实现文献发现、筛选分级、Zotero 写回、标题翻译、偏好学习和报表生成。

[中文](#中文) | [English](#english-version)

# 中文

[快速开始](#接入-codex-创建自动化) | [付费配置服务](#付费安装配置与研究方向配置包)

## v1.3 update

v1.3 将项目整理为两个公开模块：**Automation** 和 **Skills**。前者包含自动化脚本、配置、Prompt、测试和文档；后者包含工作流依赖的 Codex / agent skills。

| 更新方向 | 内容 |
| --- | --- |
| 稳定性与代码优化 | 优化核心工作流代码，减少自动化运行中潜在的报错；收敛重复能力，明确模块职责。 |
| 筛选与语义能力 | 优化 A/B/C/D 分级规则、语义复审，让筛选结果更稳定、更可审计。 |
| 日报与反馈体验 | 优化日报格式，便于阅读、反馈、人工复核和后续偏好学习。 |

## 这是什么？

Zotero Med Pipeline 是一个围绕 Codex、Zotero、Zotero MCP、RSS、PubMed/PMC、可配置筛选规则和报表导出构建的科研文献自动化工作流。

它适合需要长期跟踪新文献、整理检索结果、维护 Zotero 文献库、收集反馈并定期生成文献评价报告的科研者和研究团队。

> 它不会替代研究判断，而是负责重复性的第一轮筛选、归类和记录，把最终判断留给研究者。

## 痛点与解决

| 常见痛点 | 工作流如何解决 |
| --- | --- |
| 新文献分散在 RSS、PubMed、期刊推送中。 | 将 RSS 和 PubMed/PMC 检索整合到同一流程。 |
| 检索结果重复多、噪声多。 | 按 DOI、PMID、PMCID、URL、规范化标题去重。 |
| 人工初筛重复、耗时、标准容易漂移。 | 使用可配置 A/B/C/D 分级规则，并保留审计记录。 |
| Zotero 收藏夹长期使用后容易混乱。 | 通过 Zotero MCP 自动写回并归入结构化收藏夹。 |
| 反馈难以沉淀，下一次筛选仍然从头开始。 | 读取反馈和筛选标准，用于后续偏好学习。 |

## 核心特色

| 特色 | 说明 |
| --- | --- |
| 四阶段自动化 | 检索、去重、分级、Zotero 写回、翻译和报表导出串成完整流程。 |
| 可配置分级 | 通过配置文件定义 A/B/C/D 筛选标准，让流程适配不同研究方向。 |
| 反馈学习 | 将用户反馈和筛选标准沉淀为可审计的偏好更新。 |
| Zotero MCP 集成 | 自动创建条目并归入日期、来源和分级收藏夹。 |
| 语义复审 | 结合 semantic search，为边界文献提供辅助复核信号。 |
| 日报与周期报告 | 输出便于人工复核、反馈和长期追踪的文献评价文件。 |

## 目录结构

```text
Automation/
  tools/        # 自动化脚本
  config/       # RSS、PubMed/PMC、分级、翻译和偏好学习配置
  prompts/      # 翻译和偏好学习 Prompt
  tests/        # 轻量验证测试
  docs/         # 工作流契约与技术说明
  .env.example  # 环境变量模板

Skills/
  med-stage-orchestrator/
  med-entry-parallel/
  med-query-learning/
  med-daily-triage/
  med-zotero-bridge/
  med-weekly-synthesis/
  med-export-policy/
  med-screening-standards/
  med-semantic-grading/
```

## 接入 Codex 创建自动化

1. 准备 Node.js 18+、PowerShell 7+、Zotero Desktop、Zotero MCP Plugin；如需语义复审，可准备 Ollama。
2. 在 Codex 中打开项目，并将工作目录切到 `Automation`。
3. 让 Codex 读取 `Automation/AGENTS.md`、`Automation/README.md` 和 `Skills/`。
4. 复制 `.env.example` 为 `.env`，配置 Zotero MCP、翻译模型、偏好学习等本地参数。
5. 修改 `config/` 下的 RSS、PubMed 检索式、筛选标准、翻译配置和偏好学习配置。
6. 在 Codex 中运行主入口，并让 Codex 汇报每个阶段的结果。

```powershell
cd Automation
node --env-file=.env tools/run_zotero_literature_filter.mjs
```

建议给 Codex 的提示词：

```text
读取 Automation/AGENTS.md，从 Automation 目录运行主工作流，按 Stage 1 到 Stage 4 汇报结果，并说明任何降级或失败原因。
```


## Skills 说明

`Skills/` 目录包含本项目配套的 Codex / agent skills，用于把文献自动化流程拆分成可复用、可审计的工作单元。它们不是独立运行的脚本，而是给 Codex 或其他支持 skills 的 agent 使用的工作说明，帮助 agent 按固定阶段执行检索、分级、写回、反馈学习和报表导出。

这些 skills 的作用是把复杂流程拆成明确边界：哪个阶段负责读取反馈，哪个阶段负责并行检索，哪个阶段负责 A/B/C/D 分级，哪个阶段负责 Zotero 写回，哪个阶段负责导出文件。这样可以减少每次运行时的临时判断，让流程更稳定，也方便后续修改某个环节而不影响其它模块。

当前包含的主要 skills：

- `med-stage-orchestrator`：约束 Stage 1 到 Stage 4 的执行顺序、门禁和降级状态。
- `med-entry-parallel`：管理 RSS 与 PubMed/PMC 两个入口的并行检索、标准化和去重前汇聚。
- `med-query-learning`：从用户反馈和筛选标准中提取偏好证据，用于后续检索与筛选优化。
- `med-daily-triage`：根据规则和语义信号对文献进行 A/B/C/D 分级，并生成每日反馈表所需字段。
- `med-zotero-bridge`：通过 Zotero MCP 处理文献写回、收藏夹归类和标题翻译补全。
- `med-semantic-grading`：在规则分级之后执行语义复核，辅助识别需要升级、降级或人工复核的条目。
- `med-weekly-synthesis`：在每日流程完成后维护周期性汇总与双周报告输出。
- `med-export-policy`：定义 `.xlsx` / `.docx` 导出优先级、fallback 链和审计字段。
- `med-screening-standards`：管理长期筛选标准文件，处理用户对筛选规则的修订建议。

## 支持项目

如果该项目帮到了你，可以请我喝杯咖啡，或者随手赞赏支持一下继续维护。
<img width="600" alt="c852b20ca26b99f8739606b28f92fed8" src="https://github.com/user-attachments/assets/a30216d0-9bde-4be5-8c9f-216b08ec3b98" />


## 付费安装配置与研究方向配置包

本项目本身开源，你可以自由下载、修改和自部署。付费服务主要面向希望节省配置时间、快速落地工作流、或希望为特定研究方向准备筛选配置的人。

需要可以联系    Email：g2269204031@163.com      小红书账号：278803432

### 付费安装配置服务

适合希望把工作流在本地跑起来，但不想自己处理环境和配置细节的用户。

- 依赖安装与运行环境检查
- `.env`、Zotero MCP、翻译模型和偏好学习配置
- Codex 自动化设置与首次运行排查

### 研究方向配置包

适合已经有明确研究方向，希望直接获得一套可复用配置模板的用户。

- RSS 与 PubMed/PMC 检索式设计
- A/B/C/D 筛选标准与分级规则配置
- 翻译、偏好学习和自动化运行清单配置

## 致谢

- **[Zotero](https://www.zotero.org/)** - 优秀的开源文献管理工具。
- **[Zotero Style](https://github.com/MuiseDestiny/zotero-style)** - 提供文献评分和星标功能。
- **[Zotero MCP Plugin](https://github.com/cookjohn/zotero-mcp)** - 提供与 Zotero 的 MCP 集成能力。
- **[Codex](https://github.com/openai/codex)** - AI 编程助手，本项目的代码生成工具。
- **[Ollama](https://ollama.com/)** - 本地大语言模型服务，用于语义复审功能。

## License

MIT License. See [LICENSE](LICENSE).

---

# English Version

# Zotero Med Pipeline

A Codex-driven research literature automation workflow for discovery, triage, Zotero writeback, translation, feedback learning, and report generation.

[Quick Start](#quick-start-with-codex) | [Paid Setup](#paid-setup--research-direction-packs)

## v1.3 update

v1.3 reorganizes the project into two public modules: **Automation** and **Skills**.

- Optimized core workflow code and reduced potential runtime errors.
- Improved A/B/C/D grading rules.
- Improved semantic review and semantic search integration.
- Improved daily report format for reading, feedback, and review.
- Consolidated overlapping capabilities into clearer module ownership.
- Compressed and cleaned up documentation for public release.
- Prepared sanitized examples for GitHub publishing and reuse.

## What is this?

Zotero Med Pipeline is a research literature automation workflow built around Codex, Zotero, Zotero MCP, RSS feeds, PubMed/PMC retrieval, configurable screening rules, and report export.

It is designed for researchers and teams who need to monitor new papers, filter noisy results, organize Zotero collections, collect feedback, and generate regular review reports.

> It does not replace research judgment. It automates the repetitive first pass and keeps the final decision with the researcher.

## Pain Points & Solutions

| Pain point | What the workflow does |
| --- | --- |
| New papers are scattered across RSS, PubMed, and journal feeds. | Collects RSS and PubMed/PMC results into one workflow. |
| Search results contain duplicates and low-value hits. | Deduplicates by DOI, PMID, PMCID, URL, and normalized title. |
| Manual triage is repetitive and inconsistent. | Applies configurable A/B/C/D grading rules and keeps audit records. |
| Zotero collections become messy over time. | Writes accepted items into structured Zotero collections through Zotero MCP. |
| Feedback is hard to reuse. | Reads feedback and screening standards to refine future rules. |

## Core Features

- Codex orchestration
- RSS + PubMed/PMC
- A/B/C/D triage
- Zotero MCP writeback
- Title translation
- Feedback learning
- Semantic review
- Report export

## Quick Start with Codex

1. Prepare Node.js 18+, PowerShell 7+, Zotero Desktop, Zotero MCP Plugin, and optional Ollama.
2. Open the project in Codex and use `Automation` as the working directory.
3. Ask Codex to read `Automation/AGENTS.md`, `Automation/README.md`, and `Skills/`.
4. Copy `.env.example` to `.env` and fill in local values.
5. Edit RSS, PubMed/PMC, grading, translation, and preference-learning configs under `config/`.
6. Run the main entrypoint and ask Codex to report each stage result.

```powershell
cd Automation
node --env-file=.env tools/run_zotero_literature_filter.mjs
```
## About Skills

The `Skills/` directory contains the Codex / agent skills used by this project. These skills split the literature automation workflow into reusable and auditable work units. They are not standalone scripts. Instead, they are operating instructions for Codex or other agents that support skills, helping the agent run retrieval, triage, Zotero writeback, feedback learning, and report export in a consistent order.

The purpose of these skills is to give each workflow stage a clear boundary: which stage reads feedback, which stage runs parallel retrieval, which stage performs A/B/C/D triage, which stage writes to Zotero, and which stage exports user-facing files. This reduces ad hoc decisions during each run, makes the workflow more stable, and allows one stage to evolve without rewriting the whole pipeline.

Included skills:

- `med-stage-orchestrator`: Enforces Stage 1 to Stage 4 ordering, gates, and degrade statuses.
- `med-entry-parallel`: Handles parallel RSS and PubMed/PMC retrieval, normalization, and pre-dedup aggregation.
- `med-query-learning`: Extracts preference evidence from user feedback and screening standards for future search and triage refinement.
- `med-daily-triage`: Applies rule-based and semantic A/B/C/D grading and prepares fields used by the daily feedback workbook.
- `med-zotero-bridge`: Uses Zotero MCP for item writeback, collection placement, and title translation backfill.
- `med-semantic-grading`: Runs semantic review after rule-based grading to suggest upgrades, downgrades, or human review.
- `med-weekly-synthesis`: Maintains periodic synthesis and biweekly report outputs after daily workflow completion.
- `med-export-policy`: Defines `.xlsx` / `.docx` export priority, fallback chains, and audit fields.
- `med-screening-standards`: Manages the long-lived screening standards file and user-proposed rule revisions.


## Paid Setup & Research Direction Packs

The project is open source. You can download, modify, and run it yourself. Paid support is available for users who want to save setup time or adapt the workflow to a specific research direction.

Email：g2269204031@163.com

### Paid installation & setup

Dependency installation, `.env` setup, Zotero MCP checks, translation and preference-learning configuration, Codex automation setup, and first-run troubleshooting.

### Research direction configuration pack

RSS source selection, PubMed/PMC query design, A/B/C/D screening rules, translation settings, preference-learning settings, and automation checklist.

## Support the Project

If this project helps you, you can buy me a coffee or send a small appreciation to support continued maintenance.
<img width="600" alt="ca00b3d9c0e40d64ec9e2eed542181ed" src="https://github.com/user-attachments/assets/12a37b6c-97f1-4ae0-95d1-376e9cc60f33" />


## Acknowledgements

- **[Zotero](https://www.zotero.org/)** - an excellent open-source reference manager.
- **[Zotero Style](https://github.com/MuiseDestiny/zotero-style)** - provides literature rating and star features.
- **[Zotero MCP Plugin](https://github.com/cookjohn/zotero-mcp)** - provides MCP integration with Zotero.
- **[Codex](https://github.com/openai/codex)** - AI coding assistant and the code generation tool used in this project.
- **[Ollama](https://ollama.com/)** - local language model service used for semantic review.

## License

MIT License. See [LICENSE](LICENSE).
