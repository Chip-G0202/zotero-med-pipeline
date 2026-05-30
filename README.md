# Zotero Med Pipeline — 医学文献自动化管线

> 让 Zotero + AI 帮你自动发现、筛选、分级、翻译医学文献，每天几分钟，告别手工整理。
基于 [Codex](https://github.com/openai/codex) 构建的医学文献自动化工作流：RSS + PubMed 自动抓取 → AI 分级 → Zotero 写回 → 中文标题翻译 → Excel / docx 报表，全程无需手动翻期刊、筛标题。

**Language / 语言**: [中文](#中文) | [English](#english)

---

<a id="中文"></a>

# 中文

**目录**： [v1.2 更新](#zh-v12) | [v1.1 更新](#zh-v11) | [项目介绍](#zh-intro) | [核心特色](#zh-features) | [快速上手](#zh-quick-start) | [配置说明](#zh-configuration) | [星标迁移](#zh-star-migration) | [致谢](#zh-acknowledgements)

---

<a id="zh-v12"></a>

## v1.2 更新说明

这次更新重点提升了跨平台兼容性、语义复审能力和报告交付体验，让 Zotero Med Pipeline 更适合作为一个可配置、可复核、可扩展的文献自动化工具包使用。

**最大的变化：macOS 支持增强**

v1.2 完善了 macOS 场景下的路径检测、进程检测和启动策略。系统会根据运行平台选择合适的检测与启动方式，减少跨平台部署时的手动调整成本。

**更稳妥的筛选：语义复审机制**

在规则筛选之外，v1.2 新增语义复审层。系统可以同时记录规则等级、语义等级和最终等级，并将边界降级场景转入人工复核，帮助减少因规则过窄带来的误杀风险。

### 新功能

- **macOS 支持增强** — 路径、进程检测和启动策略加入跨平台分流，降低 macOS 部署成本。
- **语义复审机制** — 支持通过本地 Ollama 服务接入语义复审，输出规则等级、语义等级和最终等级。
- **边界降级复核** — 对 C→D 等容易误杀的边界场景自动标记为人工复核。
- **双周报 docx 导出** — 支持生成 `.docx` 双周报，方便阅读、归档和分享。
- **Ollama readiness 检查** — 在语义复审前检测本地服务状态，减少运行中断。

### 改进与修复

- 增强标题规范化和去重逻辑，覆盖 HTML 标签、全角字符和特殊 Unicode 符号等噪声来源。
- 改进 Zotero 写回流程，减少重复写入和集合迁移中的不一致。
- 修复翻译链路的参数兼容问题，提升 OpenAI 兼容接口的适配性。
- 新增文献池扫描补翻流程，降低历史数据漏翻概率。
- 统一计划槽时间语义，减少跨日期、跨时区场景下的间隔判断误差。
- 优化导出与归档流程，让日报、隔日报和双周报之间的衔接更稳定。

### 配置变化

- 新增 `tools/lib/ensure_ollama_ready.mjs`：本地 Ollama 服务检测与启动辅助。
- 新增 `tools/lib/biweekly_docx_report.mjs`：双周报 `.docx` 导出支持。
- 新增 `tools/lib/docx_support.mjs`：文档生成支持库。
- 更新 `.env.example`：补充跨平台配置说明，敏感值统一使用占位符。
- 更新 `config/workflow_rules.json`：保留通用规则结构，移除个人化筛选偏好。

---

<a id="zh-v11"></a>

## v1.1 更新内容

本次更新让 Zotero Med Pipeline 从一个“能用”的工具，进化成了一个“越用越聪明”的智能文献助手。

**最大的变化：双重学习机制**

以前你只能在 Excel 里标 keep/drop 来教它，现在你还可以直接在 `screening_standards.docx` 里用中文写你的想法——比如“以后少推荐这类文献”“这个方向要重点关注”——LLM 会理解你的意思，自动生成规则修改建议，更新筛选标准和 PubMed 搜索关键词。

这意味着你可以用自然语言训练自己的文献筛选器，而不需要手动编辑 JSON 或 Markdown 配置文件。

### 新功能

- **智能偏好学习** — LLM 理解你在 docx 评价区写的中文意见，自动生成规则修改建议。
- **筛选标准管理系统** — `screening_standards.md` 自动生成、规则建议表、变更追踪，所有修改都有据可查。
- **增强分级引擎** — 新增硬排除规则、更多关键词维度、期刊白名单，分级更精准。
- **写回池去重** — 自动检测 Zotero 中已有的条目，避免重复写入。
- **偏好学习审计** — 完整的证据链追踪，每次学习都记录在 `preference_learning_audit.json` 中。

### 改进

- 流水线编排增强，Stage 1 学习门禁更严格。
- MCP 就绪检查集成，Stage 2/3 前自动验证 Zotero 连接。
- 翻译配置更灵活，支持更多 OpenAI 兼容接口。
- 报表导出更稳定，新增导出方法审计。

### 配置变化

- 新增 `config/preference_learning.config.json` — 偏好学习 LLM 配置。
- 新增 `prompts/preference_learning.md` — 偏好学习提示词模板。
- 新增 `screening_standards.md` — 筛选标准主文件，首次运行时可自动创建。
- 更新 `config/workflow_rules.json` — 新增硬排除规则和期刊白名单。

---

<a id="zh-intro"></a>

## 📖 这是什么？

### 为什么要做这个

作为一个医学研究者，每周都要花大量时间做同一件事：

- 打开一堆综合性期刊（Nature、Science、Cell 等），在大量物理、化学、天文文章里翻找医学相关研究。
- 即使在医学期刊里，和自己细分方向真正相关的也只有一小部分。
- 手动检索 PubMed、逐个看标题摘要、判断要不要精读，重复、枯燥、低效。

于是有了这个项目。

### 怎么做的

设计思路和管线逻辑由我构思，具体代码由 [Codex](https://github.com/openai/codex) 生成。这是一个医学研究者和 AI 编程助手协作完成的项目。

### 能做什么

**Zotero Med Pipeline** 自动完成从文献发现到整理的全流程：

```text
RSS 订阅 / PubMed 检索 → 去重合并 → AI 分级(A/B/C/D) → 写回 Zotero → 标题翻译 → 导出 Excel / docx 报表
```

每天打开 Codex 说一句话，它可以自动跑完整条管线。你只需要打开报表看结果。

### 有什么优势

- **不用再翻期刊目录** — RSS 自动抓取，PubMed 定时检索，文献自己找上门。
- **不用再逐个筛标题** — AI 按你的研究方向自动分 A/B/C/D 四级，重点看 A 和 B。
- **越用越懂你** — 在 Excel 里标 keep/drop/upgrade/downgrade，它会学习你的偏好。
- **会理解你的评价** — 在 `screening_standards.docx` 里写中文意见，LLM 会辅助修改筛选规则。
- **和 Zotero 无缝衔接** — 分级结果直接写入 Zotero，归类到每日收藏夹。
- **中文标题一目了然** — A/B/C 级文献自动翻译中文标题，浏览效率更高。

---

<a id="zh-features"></a>

## ✨ 核心特色

- **四阶段管线** — 入库 → 写回 Zotero → 翻译回填 → 报表导出，每阶段有严格的门禁检查。
- **双重学习机制** — Excel 反馈（规则引擎）+ docx 评价（LLM 理解），两种方式互补。
- **智能偏好学习** — LLM 理解你在 docx 评价区写的中文意见，自动生成规则修改建议。
- **筛选标准管理** — `screening_standards.md` 自动生成、规则建议表、变更追踪。
- **增强分级引擎** — 硬排除规则、多关键词维度、期刊白名单。
- **写回池去重** — 避免重复写入 Zotero，自动检测已有条目。
- **偏好学习审计** — 完整的证据链追踪，每次学习都有据可查。
- **Zotero 无缝集成** — 通过 Zotero MCP 插件自动创建文献条目、归类到每日收藏夹。
- **隔日自动报表** — 每两天出一份 `隔日报.xlsx`，A/B/C 三级文献一目了然。
- **双周综合报表** — 每两周生成一份 `双周报-*.docx` 汇总报告，方便回顾趋势。
- **标题自动翻译** — A/B/C 级文献自动翻译成中文标题，方便中文用户快速浏览。

---

## 🧩 六个 Skill

| Skill | 作用 | 一句话说明 |
|---|---|---|
| `med-stage-orchestrator` | 四阶段编排 | 保证 Stage 1→2→3→4 顺序执行，上游失败则下游不跑 |
| `med-entry-parallel` | 并行入库 | RSS + PubMed/PMC 同时拉取，合并去重 |
| `med-query-learning` | 反馈学习 | 从上一期 Excel 反馈和 docx 评价中学习，调整搜索策略和筛选规则 |
| `med-daily-triage` | 每日分级 | 按关键词、期刊、反馈信号把文献分 A/B/C/D 四级 |
| `med-zotero-bridge` | Zotero 写回 | 自动在 Zotero 创建文献条目、归类到每日收藏夹 |
| `med-weekly-synthesis` | 双周综合 | 生成 `隔日报.xlsx` 和 `双周报-*.docx` |

---

<a id="zh-quick-start"></a>

## 🚀 快速上手（6 步）

### Step 1: 安装前置依赖

| 依赖 | 用途 | 安装方式 |
|---|---|---|
| [Zotero](https://www.zotero.org/) | 文献管理工具 | 下载安装即可 |
| Zotero MCP Plugin | 让 Codex 读写你的 Zotero 库 | 在 Zotero 插件管理器中安装 |
| [Zotero Style](https://github.com/muisedman/Zotero-Style) | 文献评分/星标功能，可选 | 在 Zotero 插件管理器中安装 |
| [Node.js](https://nodejs.org/) >= 18 | 运行管线脚本 | `brew install node` 或官网下载 |
| [PowerShell 7](https://github.com/PowerShell/PowerShell) >= 7.0 | 跨平台脚本执行 | `brew install powershell` 或官网下载 |
| [Codex](https://github.com/openai/codex) | AI 编程助手，运行管线的入口 | 下载安装即可 |

### Step 2: 克隆项目

```bash
git clone https://github.com/Chip-G0202/zotero-med-pipeline.git
cd zotero-med-pipeline
```

<a id="zh-configuration"></a>

### Step 3: 配置环境变量

复制环境变量模板：

```bash
cp .env.example .env
```

编辑 `.env` 文件，填入你的配置：

```env
# 必填：Zotero MCP 插件的 API Key
ZOTERO_API_KEY=your_zotero_api_key_here

# 必填：你的 Zotero 用户或群组库 ID
ZOTERO_LIBRARY_ID=your_zotero_library_id_here

# 必填：库类型。个人库填 user，群组库填 group
ZOTERO_LIBRARY_TYPE=user_or_group

# Zotero MCP 服务地址
ZOTERO_MCP_URL=http://127.0.0.1:23120/mcp
ZOTERO_MCP_BASE_URL=http://127.0.0.1:23120

# 可选：标题翻译使用的 OpenAI 兼容接口
TITLE_TRANSLATION_API_KEY=YOUR_API_KEY
TITLE_TRANSLATION_ENDPOINT=YOUR_ENDPOINT
TITLE_TRANSLATION_MODEL=YOUR_MODEL

# 可选：Zotero 可执行文件路径。通常可以留空，让系统自动检测
# Windows 示例：ZOTERO_EXE=D:/Zotero/zotero.exe
# macOS 示例：ZOTERO_EXE=/Applications/Zotero.app
# Linux 示例：ZOTERO_EXE=/path/to/your/zotero
# ZOTERO_EXE=

# PWSH_PATH=pwsh
# FORCE_RESEARCH_OS_RUN=true
```

**变量说明：**

| 变量 | 是否必填 | 说明 |
|---|---|---|
| `ZOTERO_API_KEY` | 是 | Zotero MCP 插件的 API Key |
| `ZOTERO_LIBRARY_ID` | 是 | Zotero 用户库或群组库 ID |
| `ZOTERO_LIBRARY_TYPE` | 是 | 个人库填 `user`，群组库填 `group` |
| `TITLE_TRANSLATION_API_KEY` | 否 | 标题翻译 API Key。为空时跳过翻译，保留英文标题 |
| `PREFERENCE_LEARNING_API_KEY` | 否 | 偏好学习 LLM API Key。为空时可回退到翻译 API Key |
| `ZOTERO_MCP_URL` | 否 | Zotero MCP 地址，默认 `http://127.0.0.1:23120/mcp` |
| `ZOTERO_EXE` | 否 | Zotero 可执行文件路径。自动检测失败时再填写 |
| `PWSH_PATH` | 否 | PowerShell 7 路径，默认 `pwsh` |
| `FORCE_RESEARCH_OS_RUN` | 否 | 设为 `true` 可强制立即运行，忽略 2 天间隔门禁 |

> **配置提示：** `config/` 目录下的 JSON 文件和 `screening_standards.md` 可能比较复杂。你可以把自己的研究方向、重点疾病、关注机制、排除标准和常用期刊告诉 AI，让 AI 辅助生成或修改这些配置文件，再由你最后检查确认。

---

### Step 4: 配置检索来源和筛选标准

#### 4.1 RSS 订阅（`config/rss_sources.json`）

添加你关注期刊的 RSS feed：

```json
{
  "sources": [
    {
      "name": "Nature Medicine",
      "url": "https://www.nature.com/nm.rss",
      "enabled": true
    },
    {
      "name": "The Lancet",
      "url": "https://www.thelancet.com/rssfeed/lancet_current.xml",
      "enabled": true
    }
  ]
}
```

字段说明：

- `name`：期刊名称，仅用于显示。
- `url`：RSS feed URL。
- `enabled`：`true` 表示启用，`false` 表示暂时停用。

#### 4.2 PubMed 检索策略（`config/pubmed_pmc_search.json`）

配置 PubMed 检索关键词：

```json
{
  "days_back": 7,
  "retmax": 300,
  "query": "",
  "keyword_groups": {
    "required": [
      ["diabetes", "diabetic"],
      ["kidney", "renal"]
    ],
    "optional": [
      ["biomarker", "biomarkers"],
      ["clinical trial"]
    ],
    "negative": [
      "case report"
    ]
  }
}
```

字段说明：

- `days_back`：向前检索多少天，默认 7。
- `retmax`：最大返回数量，默认 300。
- `query`：直接填写 PubMed 检索式；如果填写，则优先使用它。
- `keyword_groups.required`：必须包含的关键词组；组内 OR，组间 AND。
- `keyword_groups.optional`：可选关键词，命中后提高评分。
- `keyword_groups.negative`：排除关键词。

#### 4.3 筛选标准（`screening_standards.md`）

这是核心筛选规则文件。管线会根据这些规则把文献分为 A/B/C/D。

建议结构：

```markdown
## 优先关注

* Prioritize clinical studies and basic research related to [your research direction].
* Prioritize studies with clear biomarkers or molecular mechanisms.

## 相对降权

* Demote studies with small sample sizes or lack of control groups.
* Demote purely descriptive case reports without mechanistic exploration.

## 严格排除

* Exclude research completely unrelated to medicine.
* Exclude methodological papers without substantial medical insights.
```

如果你不想手动写，可以让 AI 根据你的研究方向辅助生成第一版。例如：

```text
请根据我的研究方向，帮我生成 screening_standards.md。
我的重点方向是：[填写你的方向]
优先关注：[填写机制、疾病、模型、组学、临床类型]
相对降权：[填写不太想看的研究]
严格排除：[填写直接排除的研究类型]
```

#### 4.4 分级规则（`config/workflow_rules.json`）

定义 A/B/C/D 四级关键词权重和阈值。

建议重点修改：

- `terms.pollutant`：与你研究相关的暴露因素关键词。
- `terms.core_topic`：你的核心研究方向关键词。
- `journal_whitelist`：你重点关注的期刊。

通常不需要频繁修改：

- `weights`：各关键词维度权重。
- `thresholds`：A/B/C/D 分级阈值。

#### 4.5 翻译配置（`config/title_translation.config.json`）

```json
{
  "model": "your-model-name",
  "temperature": 0.2,
  "batch_size": 10,
  "fallback_to_english": true
}
```

可调整参数：

- `model`：翻译模型名称。
- `batch_size`：每批翻译数量。
- `fallback_to_english`：翻译失败时是否保留英文标题，建议保持 `true`。

#### 4.6 偏好学习配置（`config/preference_learning.config.json`）

```json
{
  "model": "your-model-name",
  "temperature": 0.2,
  "max_retries": 2,
  "prompt_file": "prompts/preference_learning.md"
}
```

可调整参数：

- `model`：偏好学习模型名称。
- `temperature`：生成温度，越低越保守。
- `max_retries`：失败后的重试次数。

---

### Step 5: 首次运行

1. 打开 Codex。
2. 把项目文件夹拖入 Codex workspace。
3. 对 Codex 说：

```text
运行医学文献管线
```

Codex 会按顺序执行所有阶段，并在 `research_os/文献评价/` 下生成 `隔日报.xlsx`。

### Step 6: 配置自动化

管线内置 2 天间隔门禁，默认每 2 天运行一次。你可以通过 Codex 的自动化功能设置定时任务。

对 Codex 说：

```text
帮我设置一个自动化任务，每 2 天运行一次医学文献管线。
```

也可以在 Codex 的 Automation 面板中手动设置：

1. 点击 Create Automation。
2. 设置名称，例如 `Medical Literature Pipeline`。
3. 设置计划，例如 `FREQ=DAILY;INTERVAL=2`。
4. 设置 working directory 为项目根目录。
5. 设置 prompt 为 `运行医学文献管线`。

---

<a id="zh-star-migration"></a>

## ⭐ 星标迁移功能（可选）

本功能依赖 [Zotero Style](https://github.com/muisedman/Zotero-Style) 插件，可以将你标记为高星（4–5 星）的文献自动迁移到 `值得精读` 收藏夹。

### 配置 Zotero Style 插件

1. 从 [Zotero Style Releases](https://github.com/muisedman/Zotero-Style/releases) 下载最新 `.xpi` 文件。
2. 在 Zotero 中通过 `工具 → 插件 → Install Add-on From File` 安装。
3. 安装后，在 Zotero 文献列表中启用评分列。

### 环境变量配置

```env
# 星标迁移模式：expand（默认，扫描 A+B+C 级）/ legacy（仅 A+B 级）/ disabled（禁用）
ZOTERO_STAR_MIGRATION_MODE=expand

# 扫描窗口：检查最近多少天内的文献，默认 7
ZOTERO_STAR_MIGRATION_WINDOW_DAYS=7

# 最低星级阈值：达到多少星才迁移，默认 4，范围 1-5
ZOTERO_STAR_MIGRATION_MIN_STARS=4
```

### 迁移流程

1. 管线扫描最近写入的文献。
2. 找到星级 ≥ 阈值的文献。
3. 将其添加到 `值得精读` 收藏夹。
4. 从原日期收藏夹和分级收藏夹中移除，保持 Zotero 收藏夹整洁。

---

<a id="zh-acknowledgements"></a>

## 🙏 致谢

- [Zotero](https://www.zotero.org/) — 优秀的开源文献管理工具。
- [Zotero Style](https://github.com/muisedman/Zotero-Style) — 提供文献评分和星标功能。
- Zotero MCP — 提供与 Zotero 的 MCP 集成能力。
- [Codex](https://github.com/openai/codex) — AI 编程助手，本项目的代码生成工具。
- [Ollama](https://ollama.ai/) — 本地大语言模型服务，用于语义复审功能。

---

<a id="english"></a>

# English

**Contents**: [v1.2](#en-v12) | [v1.1](#en-v11) | [Overview](#en-intro) | [Features](#en-features) | [Quick Start](#en-quick-start) | [Configuration](#en-configuration) | [Star Migration](#en-star-migration) | [Acknowledgements](#en-acknowledgements)

---

<a id="en-v12"></a>

## v1.2 Release Notes

This release improves cross-platform compatibility, semantic review, and report delivery. It makes Zotero Med Pipeline more suitable as a configurable, reviewable, and extensible toolkit for automated literature workflows.

**Main change: improved macOS support**

v1.2 improves path detection, process detection, and startup behavior on macOS. The pipeline now chooses platform-specific detection and launch strategies, reducing manual adjustment during cross-platform deployment.

**Safer triage: semantic review**

In addition to rule-based screening, v1.2 adds a semantic review layer. The system can record the rule-based grade, semantic grade, and final grade, and it can move borderline downgrade cases into manual review to reduce false exclusions caused by overly narrow rules.

### New Features

- **Improved macOS support** — Platform-aware path, process, and launch handling.
- **Semantic review** — Optional semantic review through a local Ollama service, with rule grade, semantic grade, and final grade output.
- **Borderline downgrade review** — Automatically marks risky downgrade cases, such as C→D, for manual review.
- **Biweekly docx reports** — Generates `.docx` biweekly reports for reading, archiving, and sharing.
- **Ollama readiness check** — Checks local service availability before semantic review.

### Improvements and Fixes

- Improved title normalization and deduplication for HTML tags, full-width characters, and special Unicode symbols.
- Improved Zotero write-back flow to reduce duplicate writes and collection migration inconsistencies.
- Fixed translation parameter compatibility for OpenAI-compatible endpoints.
- Added backfill translation scanning for the literature pool.
- Unified planned-slot time semantics to reduce cross-date and cross-timezone interval errors.
- Improved export and archive flow for daily, every-two-day, and biweekly reports.

### Configuration Changes

- Added `tools/lib/ensure_ollama_ready.mjs` for local Ollama readiness checks and startup assistance.
- Added `tools/lib/biweekly_docx_report.mjs` for `.docx` biweekly report export.
- Added `tools/lib/docx_support.mjs` as the document generation support library.
- Updated `.env.example` with cross-platform configuration notes and placeholder secrets.
- Updated `config/workflow_rules.json` to keep a general rule structure and remove personal screening preferences.

---

<a id="en-v11"></a>

## v1.1 Release Notes

This release turns Zotero Med Pipeline from a usable tool into a literature assistant that can learn from your feedback.

**Main change: dual learning mechanism**

Previously, you could teach the system only by marking keep/drop in Excel. Now you can also write natural-language comments in `screening_standards.docx`, such as “recommend fewer papers of this type” or “pay more attention to this direction.” The LLM can interpret those comments, generate rule-change suggestions, and update both screening standards and PubMed search keywords.

This means you can train your literature filter with natural language instead of manually editing JSON or Markdown files.

### New Features

- **Preference learning** — The LLM interprets comments in the docx evaluation area and generates rule-change suggestions.
- **Screening standards management** — `screening_standards.md` generation, rule suggestion tables, and change tracking.
- **Enhanced grading engine** — Hard exclusion rules, richer keyword dimensions, and journal whitelists.
- **Write-back pool deduplication** — Detects existing Zotero items to avoid duplicate writes.
- **Preference learning audit** — Records learning evidence in `preference_learning_audit.json`.

### Improvements

- Enhanced pipeline orchestration with stricter Stage 1 learning gates.
- Integrated MCP readiness checks before Stage 2/3.
- More flexible translation configuration for OpenAI-compatible endpoints.
- More stable report export with export-method auditing.

### Configuration Changes

- Added `config/preference_learning.config.json` for preference-learning LLM settings.
- Added `prompts/preference_learning.md` as the preference-learning prompt template.
- Added `screening_standards.md` as the main screening standards file, which can be created automatically on first run.
- Updated `config/workflow_rules.json` with hard exclusion rules and journal whitelists.

---

<a id="en-intro"></a>

## 📖 What Is This?

### Why this project exists

As a medical researcher, you often spend a large amount of time on repetitive literature work:

- Opening broad journals such as Nature, Science, and Cell, then searching through many non-medical articles for biomedical studies.
- Reading medical journals where only a small portion of papers are truly relevant to your specific field.
- Manually searching PubMed, reading titles and abstracts one by one, and deciding whether each paper deserves deeper reading.

This project was built to reduce that repetitive work.

### How it was built

The workflow design and pipeline logic were designed by me. The implementation was generated with [Codex](https://github.com/openai/codex). It is a collaboration between a medical researcher and an AI coding assistant.

### What it does

**Zotero Med Pipeline** automates the full workflow from literature discovery to organization:

```text
RSS feeds / PubMed search → Deduplication → AI grading (A/B/C/D) → Zotero write-back → Title translation → Excel / docx reports
```

You can open Codex, give one instruction, and let the pipeline run. Then you review the generated report.

### Advantages

- **No more manual journal browsing** — RSS and PubMed searches bring new papers to you.
- **No more title-by-title triage** — AI grades papers into A/B/C/D based on your research interests.
- **Learns from your feedback** — Excel labels such as keep/drop/upgrade/downgrade help refine future screening.
- **Understands written comments** — Comments in `screening_standards.docx` can help the LLM adjust screening rules.
- **Works with Zotero** — Graded papers are written back to Zotero and organized into daily collections.
- **Chinese title translation** — A/B/C papers can receive Chinese title translations for faster browsing.

---

<a id="en-features"></a>

## ✨ Key Features

- **Four-stage pipeline** — Intake → Zotero write-back → Translation backfill → Report export, with gate checks at each stage.
- **Dual learning mechanism** — Excel feedback plus docx comments, combining rule-based learning and LLM interpretation.
- **Preference learning** — The LLM interprets written comments and generates rule-change suggestions.
- **Screening standards management** — `screening_standards.md` generation, suggestion tables, and change tracking.
- **Enhanced grading engine** — Hard exclusion rules, multiple keyword dimensions, and journal whitelists.
- **Zotero deduplication** — Avoids duplicate Zotero entries by detecting existing items.
- **Preference learning audit** — Keeps a traceable evidence chain for each learning update.
- **Zotero integration** — Creates Zotero items and organizes them into daily collections through Zotero MCP.
- **Every-two-day reports** — Generates `隔日报.xlsx` for A/B/C literature review.
- **Biweekly synthesis reports** — Generates `双周报-*.docx` for trend review.
- **Automatic title translation** — Translates A/B/C paper titles into Chinese for faster browsing.

---

## 🧩 Six Skills

| Skill | Role | Summary |
|---|---|---|
| `med-stage-orchestrator` | Four-stage orchestration | Ensures Stage 1→2→3→4 order and blocks downstream stages if upstream stages fail |
| `med-entry-parallel` | Parallel intake | Pulls RSS and PubMed/PMC records in parallel, then deduplicates them |
| `med-query-learning` | Feedback learning | Learns from the previous Excel feedback and docx comments to adjust search and screening rules |
| `med-daily-triage` | Daily grading | Grades papers into A/B/C/D using keywords, journals, and feedback signals |
| `med-zotero-bridge` | Zotero write-back | Creates Zotero items and organizes them into daily collections |
| `med-weekly-synthesis` | Biweekly synthesis | Generates `隔日报.xlsx` and `双周报-*.docx` |

---

<a id="en-quick-start"></a>

## 🚀 Quick Start: 6 Steps

### Step 1: Install prerequisites

| Dependency | Purpose | Installation |
|---|---|---|
| [Zotero](https://www.zotero.org/) | Reference manager | Download and install |
| Zotero MCP Plugin | Allows Codex to read and write your Zotero library | Install through the Zotero plugin manager |
| [Zotero Style](https://github.com/muisedman/Zotero-Style) | Optional paper rating/star feature | Install through the Zotero plugin manager |
| [Node.js](https://nodejs.org/) >= 18 | Runs pipeline scripts | `brew install node` or download from the website |
| [PowerShell 7](https://github.com/PowerShell/PowerShell) >= 7.0 | Cross-platform script execution | `brew install powershell` or download from the website |
| [Codex](https://github.com/openai/codex) | AI coding assistant and pipeline entry point | Download and install |

### Step 2: Clone the repository

```bash
git clone https://github.com/Chip-G0202/zotero-med-pipeline.git
cd zotero-med-pipeline
```

<a id="en-configuration"></a>

### Step 3: Configure environment variables

Copy the environment template:

```bash
cp .env.example .env
```

Edit `.env` and fill in your values:

```env
# Required: API key from your Zotero MCP plugin
ZOTERO_API_KEY=your_zotero_api_key_here

# Required: your Zotero user or group library ID
ZOTERO_LIBRARY_ID=your_zotero_library_id_here

# Required: library type. Use user for personal libraries and group for group libraries
ZOTERO_LIBRARY_TYPE=user_or_group

# Zotero MCP service URL
ZOTERO_MCP_URL=http://127.0.0.1:23120/mcp
ZOTERO_MCP_BASE_URL=http://127.0.0.1:23120

# Optional: OpenAI-compatible title translation API
TITLE_TRANSLATION_API_KEY=YOUR_API_KEY
TITLE_TRANSLATION_ENDPOINT=YOUR_ENDPOINT
TITLE_TRANSLATION_MODEL=YOUR_MODEL

# Optional: Zotero executable path. Usually you can leave this empty
# Windows example: ZOTERO_EXE=D:/Zotero/zotero.exe
# macOS example: ZOTERO_EXE=/Applications/Zotero.app
# Linux example: ZOTERO_EXE=/path/to/your/zotero
# ZOTERO_EXE=

# PWSH_PATH=pwsh
# FORCE_RESEARCH_OS_RUN=true
```

**Variable details:**

| Variable | Required | Description |
|---|---|---|
| `ZOTERO_API_KEY` | Yes | API key from the Zotero MCP plugin |
| `ZOTERO_LIBRARY_ID` | Yes | Zotero user or group library ID |
| `ZOTERO_LIBRARY_TYPE` | Yes | Use `user` for personal libraries and `group` for group libraries |
| `TITLE_TRANSLATION_API_KEY` | No | Title translation API key. If empty, translation is skipped and English titles are kept |
| `PREFERENCE_LEARNING_API_KEY` | No | Preference-learning LLM API key. Can fall back to the translation API key |
| `ZOTERO_MCP_URL` | No | Zotero MCP URL. Default: `http://127.0.0.1:23120/mcp` |
| `ZOTERO_EXE` | No | Zotero executable path. Set only if auto-detection fails |
| `PWSH_PATH` | No | PowerShell 7 path. Default: `pwsh` |
| `FORCE_RESEARCH_OS_RUN` | No | Set to `true` to force an immediate run and ignore the two-day interval gate |

> **Configuration tip:** The JSON files under `config/` and `screening_standards.md` can be complex. You can ask an AI assistant to help generate or revise them from your research direction, target diseases, mechanisms of interest, exclusion criteria, and preferred journals. Always review the generated configuration before running the pipeline.

---

### Step 4: Configure search sources and screening standards

#### 4.1 RSS subscriptions (`config/rss_sources.json`)

Add RSS feeds for journals you follow:

```json
{
  "sources": [
    {
      "name": "Nature Medicine",
      "url": "https://www.nature.com/nm.rss",
      "enabled": true
    },
    {
      "name": "The Lancet",
      "url": "https://www.thelancet.com/rssfeed/lancet_current.xml",
      "enabled": true
    }
  ]
}
```

Field descriptions:

- `name`: Journal name, used only for display.
- `url`: RSS feed URL.
- `enabled`: `true` enables the feed, `false` temporarily disables it.

#### 4.2 PubMed search strategy (`config/pubmed_pmc_search.json`)

Configure PubMed search keywords:

```json
{
  "days_back": 7,
  "retmax": 300,
  "query": "",
  "keyword_groups": {
    "required": [
      ["diabetes", "diabetic"],
      ["kidney", "renal"]
    ],
    "optional": [
      ["biomarker", "biomarkers"],
      ["clinical trial"]
    ],
    "negative": [
      "case report"
    ]
  }
}
```

Field descriptions:

- `days_back`: Number of days to search backward. Default: 7.
- `retmax`: Maximum number of returned records. Default: 300.
- `query`: Direct PubMed query. If filled, it takes priority.
- `keyword_groups.required`: Required keyword groups. OR within each group, AND across groups.
- `keyword_groups.optional`: Optional keywords that increase scores when matched.
- `keyword_groups.negative`: Exclusion keywords.

#### 4.3 Screening standards (`screening_standards.md`)

This is the core screening rule file. The pipeline uses it to grade papers into A/B/C/D.

Suggested structure:

```markdown
## 优先关注

* Prioritize clinical studies and basic research related to [your research direction].
* Prioritize studies with clear biomarkers or molecular mechanisms.

## 相对降权

* Demote studies with small sample sizes or lack of control groups.
* Demote purely descriptive case reports without mechanistic exploration.

## 严格排除

* Exclude research completely unrelated to medicine.
* Exclude methodological papers without substantial medical insights.
```

If you do not want to write it manually, ask an AI assistant to generate the first draft. For example:

```text
Please generate screening_standards.md based on my research direction.
My focus area is: [your field]
Prioritize: [mechanisms, diseases, models, omics, clinical study types]
Demote: [types of studies you care less about]
Strictly exclude: [types of studies to exclude directly]
```

#### 4.4 Grading rules (`config/workflow_rules.json`)

Defines A/B/C/D keyword weights and thresholds.

Recommended sections to edit:

- `terms.pollutant`: Exposure-related keywords relevant to your research.
- `terms.core_topic`: Core topic keywords for your research direction.
- `journal_whitelist`: Journals you follow closely.

Usually no need to change frequently:

- `weights`: Weights for each keyword dimension.
- `thresholds`: A/B/C/D grading thresholds.

#### 4.5 Translation configuration (`config/title_translation.config.json`)

```json
{
  "model": "your-model-name",
  "temperature": 0.2,
  "batch_size": 10,
  "fallback_to_english": true
}
```

Adjustable parameters:

- `model`: Translation model name.
- `batch_size`: Number of items per translation batch.
- `fallback_to_english`: Whether to keep the English title when translation fails. Recommended: `true`.

#### 4.6 Preference learning configuration (`config/preference_learning.config.json`)

```json
{
  "model": "your-model-name",
  "temperature": 0.2,
  "max_retries": 2,
  "prompt_file": "prompts/preference_learning.md"
}
```

Adjustable parameters:

- `model`: Preference-learning model name.
- `temperature`: Generation temperature. Lower values are more conservative.
- `max_retries`: Number of retry attempts after failure.

---

### Step 5: First run

1. Open Codex.
2. Drag the project folder into the Codex workspace.
3. Tell Codex:

```text
运行医学文献管线
```

Codex will execute all stages in order and generate `隔日报.xlsx` under `research_os/文献评价/`.

### Step 6: Configure automation

The pipeline includes a two-day interval gate and runs once every two days by default. You can set up scheduled execution through Codex automation.

Tell Codex:

```text
帮我设置一个自动化任务，每 2 天运行一次医学文献管线。
```

You can also configure it manually in the Codex Automation panel:

1. Click Create Automation.
2. Set a name, such as `Medical Literature Pipeline`.
3. Set the schedule, such as `FREQ=DAILY;INTERVAL=2`.
4. Set the working directory to the project root.
5. Set the prompt to `运行医学文献管线`.

---

<a id="en-star-migration"></a>

## ⭐ Star Migration: Optional

This feature depends on the [Zotero Style](https://github.com/muisedman/Zotero-Style) plugin. It can automatically move high-star papers, such as 4–5 star items, into the `值得精读` collection.

### Configure Zotero Style

1. Download the latest `.xpi` file from [Zotero Style Releases](https://github.com/muisedman/Zotero-Style/releases).
2. In Zotero, install it through `Tools → Add-ons → Install Add-on From File`.
3. Enable the rating column in your Zotero item list.

### Environment variables

```env
# Star migration mode: expand (default, scans A+B+C) / legacy (A+B only) / disabled
ZOTERO_STAR_MIGRATION_MODE=expand

# Scan window: number of recent days to check. Default: 7
ZOTERO_STAR_MIGRATION_WINDOW_DAYS=7

# Minimum star threshold for migration. Default: 4, range: 1-5
ZOTERO_STAR_MIGRATION_MIN_STARS=4
```

### Migration flow

1. The pipeline scans recently written papers.
2. It finds papers with star ratings at or above the configured threshold.
3. It adds them to the `值得精读` collection.
4. It removes them from the original date and grade collections to keep Zotero tidy.

---

<a id="en-acknowledgements"></a>

## 🙏 Acknowledgements

- [Zotero](https://www.zotero.org/) — An excellent open-source reference manager.
- [Zotero Style](https://github.com/muisedman/Zotero-Style) — Provides paper rating and star features.
- Zotero MCP — Provides MCP integration with Zotero.
- [Codex](https://github.com/openai/codex) — The AI coding assistant used to generate the implementation.
- [Ollama](https://ollama.ai/) — Local LLM service used for semantic review.
