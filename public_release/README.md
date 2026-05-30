# Zotero Med Pipeline — 医学文献自动化管线

> 让 Zotero + AI 帮你自动发现、筛选、分级、翻译医学文献，每天几分钟，告别手工整理。

基于 [Codex](https://github.com/openai/codex) 构建的医学文献自动化工作流：RSS + PubMed 自动抓取 → AI 分级 → Zotero 写回 → 中文标题翻译 → Excel 报表，全程无需手动翻期刊、筛标题。

[English](#english) | [v1.2 更新内容](#v12-更新内容) | [v1.1 更新内容](#v11-更新内容) | [快速上手](#快速上手6-步) | [配置说明](#配置文件详细说明) | [FAQ](#常见问题)

---

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

## v1.1 更新内容

本次更新让 Zotero Med Pipeline 从一个"能用"的工具，进化成了一个"越用越聪明"的智能文献助手。

**最大的变化：双重学习机制**

以前你只能在 Excel 里标 keep/drop 来教它，现在你还可以直接在 screening_standards.docx 里用中文写你的想法——比如"以后少推荐这类文献"、"这个方向要重点关注"——LLM 会理解你的意思，自动生成规则修改建议，更新筛选标准和 PubMed 搜索关键词。

这意味着你可以用自然语言训练你的文献筛选器，而不需要手动编辑 JSON 或 Markdown 配置文件。

### 新功能

- **智能偏好学习** — LLM 理解你在 docx 评价区写的中文意见，自动生成规则修改建议，更新 screening_standards.md 和 PubMed 检索关键词
- **筛选标准管理系统** — screening_standards.md 自动生成、规则建议表、变更追踪，所有修改都有据可查
- **增强分级引擎** — 新增硬排除规则、更多关键词维度、期刊白名单，分级更精准
- **写回池去重** — 自动检测 Zotero 中已有的条目，避免重复写入
- **偏好学习审计** — 完整的证据链追踪，每次学习都记录在 preference_learning_audit.json 中

### 改进

- 流水线编排增强，Stage1 学习门禁更严格
- MCP 就绪检查集成，Stage 2/3 前自动验证 Zotero 连接
- 翻译配置更灵活，支持更多 OpenAI 兼容接口
- 报表导出更稳定，新增导出方法审计

### 配置变化

- 新增 config/preference_learning.config.json — 偏好学习 LLM 配置
- 新增 prompts/preference_learning.md — 偏好学习提示词模板
- 新增 screening_standards.md — 筛选标准主文件（首次运行自动创建）
- 更新 config/workflow_rules.json — 新增硬排除规则和期刊白名单

---

## 📖 这是什么？

### 为什么要做这个

作为一个医学研究者，每周都要花大量时间做同一件事：

- 打开一堆综合性期刊（Nature、Science、Cell……），在一堆物理、化学、天文文章里翻找医学相关的研究
- 即使在医学期刊里，和自己细分方向真正相关的也就一小部分，大部分一眼扫过就关了
- 手动检索 PubMed、逐个看标题摘要、判断要不要精读——重复、枯燥、低效

于是有了这个项目。

### 怎么做的

设计思路和管线逻辑由我构思，具体代码由 [Codex](https://github.com/openai/codex) 生成——一个医学研究者 + AI 编程助手的协作产物。

### 能做什么

**Zotero Med Pipeline** 自动完成从文献发现到整理的全流程：

```text
RSS 订阅 / PubMed 检索  →  去重合并  →  AI 分级(A/B/C/D)  →  写回 Zotero  →  标题翻译  →  导出 Excel 报表
```

每天打开 Codex 说一句话，它自动跑完整条管线，你只需要打开 Excel 看结果。

### 有什么优势

- **不用再翻期刊目录** — RSS 自动抓取，PubMed 定时检索，文献自己找上门
- **不用再逐个筛标题** — AI 按你的研究方向自动分 A/B/C/D 四级，重点看 A 和 B
- **越用越懂你** — 在 Excel 里标 keep/drop/upgrade/downgrade，它会学习你的偏好，下次搜得更准
- **会理解你的评价** — 在 screening_standards.docx 里写中文意见，LLM 会自动帮你修改筛选规则
- **和 Zotero 无缝衔接** — 分级结果直接写入 Zotero，归类到每日收藏夹，PDF 拖进去就能读
- **中文标题一目了然** — A/B/C 级文献自动翻译中文标题，浏览效率翻倍

---

## ✨ 核心特色

- **四阶段管线** — 入库 → 写回 Zotero → 翻译回填 → 报表导出，每阶段有严格的门禁检查
- **双重学习机制** — Excel 反馈（规则引擎）+ docx 评价（LLM 理解），两种方式互补
- **智能偏好学习** — LLM 理解你在 docx 评价区写的中文意见，自动生成规则修改建议
- **筛选标准管理** — screening_standards.md 自动生成、规则建议表、变更追踪
- **增强分级引擎** — 硬排除规则、多关键词维度、期刊白名单
- **写回池去重** — 避免重复写入 Zotero，自动检测已有条目
- **偏好学习审计** — 完整的证据链追踪，每次学习都有据可查
- **Zotero 无缝集成** — 通过 Zotero MCP 插件自动创建文献条目、归类到每日收藏夹
- **隔日自动报表** — 每两天出一份 隔日报.xlsx，A/B/C 三级文献一目了然
- **双周综合报表** — 每两周生成一份 `双周报-*.docx` 汇总报告，方便回顾趋势
- **标题自动翻译** — A/B/C 级文献自动翻译成中文标题，方便中文用户快速浏览
---

## 🧩 六个 Skill

| Skill | 作用 | 一句话说明 |
|---|---|---|
| med-stage-orchestrator | 四阶段编排 | 保证 Stage1→2→3→4 顺序执行，上游失败则下游不跑 |
| med-entry-parallel | 并行入库 | RSS + PubMed/PMC 同时拉取，合并去重 |
| med-query-learning | 反馈学习 | 从上一期 Excel 反馈和 docx 评价中学习，调整搜索策略和筛选规则 |
| med-daily-triage | 每日分级 | 按关键词、期刊、反馈信号把文献分 A/B/C/D 四级 |
| med-zotero-bridge | Zotero 写回 | 自动在 Zotero 创建文献条目、归类到每日收藏夹 |
| med-weekly-synthesis | 双周综合 | 生成 隔日报.xlsx 和 双周报-*.docx |

---

## 🚀 快速上手（6 步）

### Step 1: 安装前置依赖

| 依赖 | 用途 | 安装方式 |
|---|---|---|
| [Zotero](https://www.zotero.org/) | 文献管理工具 | 下载安装即可 |
| [Zotero MCP Plugin](https://github.com/your-zotero-mcp-plugin) | 让 Codex 读写你的 Zotero 库 | 在 Zotero 插件管理器中安装 |
| [Zotero Style](https://github.com/muisedman/Zotero-Style) | 文献评分/星标功能（可选） | 在 Zotero 插件管理器中安装 |
| [Node.js](https://nodejs.org/) >= 18 | 运行管线脚本 | `brew install node` 或官网下载 |
| [PowerShell 7](https://github.com/PowerShell/PowerShell) >= 7.0 | 跨平台脚本执行 | `brew install powershell` 或官网下载 |
| [Codex Desktop](https://github.com/openai/codex) | AI 编程助手，运行管线的入口 | 下载安装即可 |

### Step 2: 克隆项目

```bash
git clone https://github.com/Chip-G0202/zotero-med-pipeline.git
cd zotero-med-pipeline
```

### Step 3: 配置环境变量

复制环境变量模板：

```bash
cp .env.example .env
```

编辑 `.env` 文件，填入你的配置：

```env
# ── 必填 ──────────────────────────────────────────────
# Zotero MCP 插件的 API Key（在 Zotero MCP 插件设置中获取）
ZOTERO_API_KEY=your_zotero_api_key_here

# 你的 Zotero 用户或群组库 ID
ZOTERO_LIBRARY_ID=your_zotero_library_id_here

# 库类型：个人库填 user，群组库填 group
ZOTERO_LIBRARY_TYPE=user_or_group

# Zotero MCP 服务地址（本地服务通常为 http://127.0.0.1:<PORT>/mcp）
# 请根据你的 Zotero MCP 插件实际监听端口修改，以下为默认示例：
ZOTERO_MCP_URL=http://127.0.0.1:23120/mcp
ZOTERO_MCP_BASE_URL=http://127.0.0.1:23120

# ── 翻译 API（可选）──────────────────────────────────
# 标题翻译使用的 OpenAI 兼容接口
# 如果不填，跳过翻译，直接使用英文标题
TITLE_TRANSLATION_API_KEY=YOUR_API_KEY
TITLE_TRANSLATION_ENDPOINT=YOUR_ENDPOINT
TITLE_TRANSLATION_MODEL=YOUR_MODEL

# ── 其他（通常无需修改）────────────────────────────────
# Zotero 可执行文件路径（通常可省略，系统会自动检测）
# Windows 示例：ZOTERO_EXE=D:/Zotero/zotero.exe 或 C:/Program Files/Zotero/zotero.exe
# macOS 示例：  ZOTERO_EXE=/Applications/Zotero.app（或 /Applications/Zotero.app/Contents/MacOS/zotero）
# ZOTERO_EXE=

# PWSH_PATH=pwsh
# FORCE_RESEARCH_OS_RUN=true  # Set to true to force immediate run, ignoring interval
```

**Variable Details:**

| Variable | Required | Description |
|---|---|---|
| `TITLE_TRANSLATION_API_KEY` | Optional | Title translation API key (OpenAI-compatible interface). Skips if empty, uses English titles |
| `PREFERENCE_LEARNING_API_KEY` | Optional | Preference learning LLM API key. Falls back to translation key. If both empty, docx evaluation feedback not automatically processed |
| `ZOTERO_MCP_URL` | Optional | Zotero MCP address. Default: `http://127.0.0.1:23120/mcp`. **Note:** This is the default port for the Zotero MCP plugin. If your plugin uses a different port, please update accordingly. |
| `ZOTERO_EXE` | Optional | Zotero executable path. The system attempts to auto-detect the path based on your platform. Only set this if auto-detection fails or you have multiple Zotero installations. |
| `PWSH_PATH` | Optional | PowerShell 7 path, default `pwsh` |
| `FORCE_RESEARCH_OS_RUN` | Optional | Set to `true` to force immediate run, ignoring 2-day interval |

---

**Cross-Platform Configuration Notes:**

- **Windows:**
  - The default candidate for `ZOTERO_EXE` is `D:/Zotero/zotero.exe`. If your Zotero is installed elsewhere (e.g., `C:/Program Files/Zotero/zotero.exe`), please set `ZOTERO_EXE` in your `.env` file.
- **macOS:**
  - You can usually leave `ZOTERO_EXE` empty. The system will attempt to launch Zotero by application name (e.g., `open -a Zotero`).
  - If auto-detection fails, you can set `ZOTERO_EXE=/Applications/Zotero.app` or the full path to the executable.
- **Linux:**
  - If Zotero is in your system's `PATH`, you can usually leave `ZOTERO_EXE` empty.
  - Otherwise, set `ZOTERO_EXE=/path/to/your/zotero`.
- **ZOTERO_MCP_URL:**
  - This is the address of the local MCP service provided by the Zotero MCP plugin.
  - The default is `http://127.0.0.1:23120/mcp`.
  - If your Zotero MCP plugin is configured to use a different port, please update this value.

---

### Step 4: Configure Search Sources and Screening Standards

#### 4.1 RSS Subscriptions (`config/rss_sources.json`)

Add the RSS feed URLs of journals you follow:

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

**Field Description:**
- `name`: Journal name (anything you like, for display)
- `url`: RSS feed URL (find the RSS icon on the journal website, right-click to copy link)
- `enabled`: `true` = enabled, `false` = temporarily disabled

**How to find RSS URLs?**
1. Open the journal website
2. Find the RSS icon (orange square) or search "RSS"
3. Right-click to copy the link address
4. Paste into the `url` field

#### 4.2 PubMed Search Strategy (`config/pubmed_pmc_search.json`)

Configure your PubMed search keywords:

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

**Field Description:**
- `days_back`: How many days back to search (default 7)
- `retmax`: Maximum number of results (default 300)
- `query`: Direct PubMed search expression (if filled, keyword_groups is ignored)
- `keyword_groups.required`: Must-contain keywords (OR within groups, AND between groups)
- `keyword_groups.optional`: Optional keywords (adds score if present)
- `keyword_groups.negative`: Excluded keywords

**How to write PubMed search expressions?**
1. Go to [PubMed](https://pubmed.ncbi.nlm.nih.gov/)
2. Enter keywords in the search box to test
3. After finding a satisfactory expression, click "Advanced" to view the full expression
4. Copy to the `query` field


#### 4.3 Screening Standards (`screening_standards.md`)

This is your core screening rules file. The pipeline uses these rules to grade literature into A/B/C/D.

**File Structure:**
- `## 优先关注` (Priority Focus): Your most important research directions (each line starts with `*`)
- `## 相对降权` (Demote): Research types you want to deprioritize
- `## 严格排除` (Strict Exclude): Rules for direct exclusion
- `## 不确定边界` (Uncertain Boundaries): Conflicting feedback cases

**Example:**
```markdown
## 优先关注

* Prioritize clinical studies and basic research related to [your research direction].
* Prioritize randomized controlled trials and high-quality cohort studies.
* Prioritize studies with clear biomarkers or molecular mechanisms.

## 相对降权

* Demote studies with small sample sizes or lack of control groups.
* Demote purely descriptive case reports without mechanistic exploration.
* Demote pure basic research far from clinical translation.

## 严格排除

* Exclude research completely unrelated to medicine (e.g., pure physics, pure engineering).
* Exclude methodological papers without substantial medical insights.
```

> 💡 **Tip**: If `screening_standards.md` doesn't exist on first run, the pipeline will automatically create a default version. Manual customization is recommended to fit your research direction.

#### 4.4 Grading Rules (`config/workflow_rules.json`)

Defines the A/B/C/D four-level keyword weights and thresholds.

**Sections to modify:**
- `terms.pollutant`: Exposure factor keywords relevant to your research
- `terms.core_topic`: Your core research direction keywords
- `journal_whitelist`: Journals you follow

**Other fields (usually no need to change):**
- `weights`: Weight for each keyword dimension
- `thresholds`: Score thresholds for A/B/C/D levels

#### 4.5 Translation Configuration (`config/title_translation.config.json`)

Translation API parameter configuration, usually defaults are fine:

```json
{
  "model": "your-model-name",
  "temperature": 0.2,
  "batch_size": 10,
  "fallback_to_english": true
}
```

**Adjustable Parameters:**
- `model`: Translation model name (fill in your model)
- `batch_size`: How many items per batch (higher = faster, but more API pressure)
- `fallback_to_english`: Whether to use English title as fallback when translation fails (recommended to keep `true`)

#### 4.6 Preference Learning Configuration (`config/preference_learning.config.json`)

LLM preference learning parameter configuration, usually defaults are fine:

```json
{
  "model": "your-model-name",
  "temperature": 0.2,
  "max_retries": 2,
  "prompt_file": "prompts/preference_learning.md"
}
```

**Adjustable Parameters:**
- `model`: Preference learning model name (fill in your model)
- `temperature`: Generation temperature (lower = more conservative, higher = more random)
- `max_retries`: Number of retry attempts on failure

### Step 5: First Run

1. Open Codex Desktop
2. Drag this project folder into the Codex workspace
3. Tell Codex: **"运行医学文献管线"**

Codex will automatically execute all stages in sequence, generating `隔日报.xlsx` under `research_os/文献评价/`.

### Step 6: Configure Automation

The pipeline has a built-in 2-day interval gate (runs once every 2 days by default). You can set up automated tasks through Codex's Automation feature.

**Method 1: Set Up Automation in Codex**

Tell Codex:

```
帮我设置一个自动化任务，每 2 天运行一次医学文献管线。
```

Codex will call the `automation_update` tool to create a cron automation task that runs the pipeline on schedule.

**Method 2: Manual Automation Setup**

In Codex's Automation panel:
1. Click "Create Automation"
2. Set a name (e.g., "Medical Literature Pipeline")
3. Set schedule (e.g., `FREQ=DAILY;INTERVAL=2` for every 2 days)
4. Set working directory to project root
5. Set prompt to `"运行医学文献管线"`

**About the Interval Gate:**
- Runs once every 2 days by default (`RESEARCH_OS_RUN_INTERVAL_DAYS=2`)
- Can be forced to run immediately by setting `FORCE_RESEARCH_OS_RUN=true` in `.env`
- Interval logic uses `Asia/Shanghai` timezone with 15:00 planned slot semantics

---

## ✨ 核心特色

- **四阶段管线** — 入库 → 写回 Zotero → 翻译回填 → 报表导出，每阶段有严格的门禁检查
- **双重学习机制** — Excel 反馈（规则引擎）+ docx 评价（LLM 理解），两种方式互补
- **智能偏好学习** — LLM 理解你在 docx 评价区写的中文意见，自动生成规则修改建议
- **筛选标准管理** — screening_standards.md 自动生成、规则建议表、变更追踪
- **增强分级引擎** — 硬排除规则、多关键词维度、期刊白名单
- **写回池去重** — 避免重复写入 Zotero，自动检测已有条目
- **偏好学习审计** — 完整的证据链追踪，每次学习都有据可查
- **Zotero 无缝集成** — 通过 Zotero MCP 插件自动创建文献条目、归类到每日收藏夹
- **隔日自动报表** — 每两天出一份 隔日报.xlsx，A/B/C 三级文献一目了然
- **双周综合报表** — 每两周生成一份 `双周报-*.docx` 汇总报告，方便回顾趋势
- **标题自动翻译** — A/B/C 级文献自动翻译成中文标题，方便中文用户快速浏览
---

## 🧩 六个 Skill

| Skill | 作用 | 一句话说明 |
|---|---|---|
| med-stage-orchestrator | 四阶段编排 | 保证 Stage1→2→3→4 顺序执行，上游失败则下游不跑 |
| med-entry-parallel | 并行入库 | RSS + PubMed/PMC 同时拉取，合并去重 |
| med-query-learning | 反馈学习 | 从上一期 Excel 反馈和 docx 评价中学习，调整搜索策略和筛选规则 |
| med-daily-triage | 每日分级 | 按关键词、期刊、反馈信号把文献分 A/B/C/D 四级 |
| med-zotero-bridge | Zotero 写回 | 自动在 Zotero 创建文献条目、归类到每日收藏夹 |
| med-weekly-synthesis | 双周综合 | 生成 隔日报.xlsx 和 双周报-*.docx |

---

## 🚀 快速上手（6 步）

### Step 1: 安装前置依赖

| 依赖 | 用途 | 安装方式 |
|---|---|---|
| [Zotero](https://www.zotero.org/) | 文献管理工具 | 下载安装即可 |
| [Zotero MCP Plugin](https://github.com/your-zotero-mcp-plugin) | 让 Codex 读写你的 Zotero 库 | 在 Zotero 插件管理器中安装 |
| [Zotero Style](https://github.com/muisedman/Zotero-Style) | 文献评分/星标功能（可选） | 在 Zotero 插件管理器中安装 |
| [Node.js](https://nodejs.org/) >= 18 | 运行管线脚本 | `brew install node` 或官网下载 |
| [PowerShell 7](https://github.com/PowerShell/PowerShell) >= 7.0 | 跨平台脚本执行 | `brew install powershell` 或官网下载 |
| [Codex Desktop](https://github.com/openai/codex) | AI 编程助手，运行管线的入口 | 下载安装即可 |

### Step 2: 克隆项目

```bash
git clone https://github.com/Chip-G0202/zotero-med-pipeline.git
cd zotero-med-pipeline
```

### Step 3: 配置环境变量

复制环境变量模板：

```bash
cp .env.example .env
```

编辑 `.env` 文件，填入你的配置：

```env
# ── 必填 ──────────────────────────────────────────────
# Zotero MCP 插件的 API Key（在 Zotero MCP 插件设置中获取）
ZOTERO_API_KEY=your_zotero_api_key_here

# 你的 Zotero 用户或群组库 ID
ZOTERO_LIBRARY_ID=your_zotero_library_id_here

# 库类型：个人库填 user，群组库填 group
ZOTERO_LIBRARY_TYPE=user_or_group

# Zotero MCP 服务地址（本地服务通常为 http://127.0.0.1:<PORT>/mcp）
# 请根据你的 Zotero MCP 插件实际监听端口修改，以下为默认示例：
ZOTERO_MCP_URL=http://127.0.0.1:23120/mcp
ZOTERO_MCP_BASE_URL=http://127.0.0.1:23120

# ── 翻译 API（可选）──────────────────────────────────
# 标题翻译使用的 OpenAI 兼容接口
# 如果不填，跳过翻译，直接使用英文标题
TITLE_TRANSLATION_API_KEY=YOUR_API_KEY
TITLE_TRANSLATION_ENDPOINT=YOUR_ENDPOINT
TITLE_TRANSLATION_MODEL=YOUR_MODEL

# ── 其他（通常无需修改）────────────────────────────────
# Zotero 可执行文件路径（通常可省略，系统会自动检测）
# Windows 示例：ZOTERO_EXE=D:/Zotero/zotero.exe 或 C:/Program Files/Zotero/zotero.exe
# macOS 示例：  ZOTERO_EXE=/Applications/Zotero.app（或 /Applications/Zotero.app/Contents/MacOS/zotero）
# ZOTERO_EXE=

# PWSH_PATH=pwsh
# FORCE_RESEARCH_OS_RUN=true  # Set to true to force immediate run, ignoring interval
```

**Variable Details:**

| Variable | Required | Description |
|---|---|---|
| `TITLE_TRANSLATION_API_KEY` | Optional | Title translation API key (OpenAI-compatible interface). Skips if empty, uses English titles |
| `PREFERENCE_LEARNING_API_KEY` | Optional | Preference learning LLM API key. Falls back to translation key. If both empty, docx evaluation feedback not automatically processed |
| `ZOTERO_MCP_URL` | Optional | Zotero MCP address. Default: `http://127.0.0.1:23120/mcp`. **Note:** This is the default port for the Zotero MCP plugin. If your plugin uses a different port, please update accordingly. |
| `ZOTERO_EXE` | Optional | Zotero executable path. The system attempts to auto-detect the path based on your platform. Only set this if auto-detection fails or you have multiple Zotero installations. |
| `PWSH_PATH` | Optional | PowerShell 7 path, default `pwsh` |
| `FORCE_RESEARCH_OS_RUN` | Optional | Set to `true` to force immediate run, ignoring 2-day interval |

---

**Cross-Platform Configuration Notes:**

- **Windows:**
  - The default candidate for `ZOTERO_EXE` is `D:/Zotero/zotero.exe`. If your Zotero is installed elsewhere (e.g., `C:/Program Files/Zotero/zotero.exe`), please set `ZOTERO_EXE` in your `.env` file.
- **macOS:**
  - You can usually leave `ZOTERO_EXE` empty. The system will attempt to launch Zotero by application name (e.g., `open -a Zotero`).
  - If auto-detection fails, you can set `ZOTERO_EXE=/Applications/Zotero.app` or the full path to the executable.
- **Linux:**
  - If Zotero is in your system's `PATH`, you can usually leave `ZOTERO_EXE` empty.
  - Otherwise, set `ZOTERO_EXE=/path/to/your/zotero`.
- **ZOTERO_MCP_URL:**
  - This is the address of the local MCP service provided by the Zotero MCP plugin.
  - The default is `http://127.0.0.1:23120/mcp`.
  - If your Zotero MCP plugin is configured to use a different port, please update this value.

---

### Step 4: Configure Search Sources and Screening Standards

#### 4.1 RSS Subscriptions (`config/rss_sources.json`)

Add the RSS feed URLs of journals you follow:

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

**Field Description:**
- `name`: Journal name (anything you like, for display)
- `url`: RSS feed URL (find the RSS icon on the journal website, right-click to copy link)
- `enabled`: `true` = enabled, `false` = temporarily disabled

**How to find RSS URLs?**
1. Open the journal website
2. Find the RSS icon (orange square) or search "RSS"
3. Right-click to copy the link address
4. Paste into the `url` field

#### 4.2 PubMed Search Strategy (`config/pubmed_pmc_search.json`)

Configure your PubMed search keywords:

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

**Field Description:**
- `days_back`: How many days back to search (default 7)
- `retmax`: Maximum number of results (default 300)
- `query`: Direct PubMed search expression (if filled, keyword_groups is ignored)
- `keyword_groups.required`: Must-contain keywords (OR within groups, AND between groups)
- `keyword_groups.optional`: Optional keywords (adds score if present)
- `keyword_groups.negative`: Excluded keywords

**How to write PubMed search expressions?**
1. Go to [PubMed](https://pubmed.ncbi.nlm.nih.gov/)
2. Enter keywords in the search box to test
3. After finding a satisfactory expression, click "Advanced" to view the full expression
4. Copy to the `query` field


#### 4.3 Screening Standards (`screening_standards.md`)

This is your core screening rules file. The pipeline uses these rules to grade literature into A/B/C/D.

**File Structure:**
- `## 优先关注` (Priority Focus): Your most important research directions (each line starts with `*`)
- `## 相对降权` (Demote): Research types you want to deprioritize
- `## 严格排除` (Strict Exclude): Rules for direct exclusion
- `## 不确定边界` (Uncertain Boundaries): Conflicting feedback cases

**Example:**
```markdown
## 优先关注

* Prioritize clinical studies and basic research related to [your research direction].
* Prioritize randomized controlled trials and high-quality cohort studies.
* Prioritize studies with clear biomarkers or molecular mechanisms.

## 相对降权

* Demote studies with small sample sizes or lack of control groups.
* Demote purely descriptive case reports without mechanistic exploration.
* Demote pure basic research far from clinical translation.

## 严格排除

* Exclude research completely unrelated to medicine (e.g., pure physics, pure engineering).
* Exclude methodological papers without substantial medical insights.
```

> 💡 **Tip**: If `screening_standards.md` doesn't exist on first run, the pipeline will automatically create a default version. Manual customization is recommended to fit your research direction.

#### 4.4 Grading Rules (`config/workflow_rules.json`)

Defines the A/B/C/D four-level keyword weights and thresholds.

**Sections to modify:**
- `terms.pollutant`: Exposure factor keywords relevant to your research
- `terms.core_topic`: Your core research direction keywords
- `journal_whitelist`: Journals you follow

**Other fields (usually no need to change):**
- `weights`: Weight for each keyword dimension
- `thresholds`: Score thresholds for A/B/C/D levels

#### 4.5 Translation Configuration (`config/title_translation.config.json`)

Translation API parameter configuration, usually defaults are fine:

```json
{
  "model": "your-model-name",
  "temperature": 0.2,
  "batch_size": 10,
  "fallback_to_english": true
}
```

**Adjustable Parameters:**
- `model`: Translation model name (fill in your model)
- `batch_size`: How many items per batch (higher = faster, but more API pressure)
- `fallback_to_english`: Whether to use English title as fallback when translation fails (recommended to keep `true`)

#### 4.6 Preference Learning Configuration (`config/preference_learning.config.json`)

LLM preference learning parameter configuration, usually defaults are fine:

```json
{
  "model": "your-model-name",
  "temperature": 0.2,
  "max_retries": 2,
  "prompt_file": "prompts/preference_learning.md"
}
```

**Adjustable Parameters:**
- `model`: Preference learning model name (fill in your model)
- `temperature`: Generation temperature (lower = more conservative, higher = more random)
- `max_retries`: Number of retry attempts on failure

### Step 5: First Run

1. Open Codex Desktop
2. Drag this project folder into the Codex workspace
3. Tell Codex: **"运行医学文献管线"**

Codex will automatically execute all stages in sequence, generating `隔日报.xlsx` under `research_os/文献评价/`.

### Step 6: Configure Automation

The pipeline has a built-in 2-day interval gate (runs once every 2 days by default). You can set up automated tasks through Codex's Automation feature.

**Method 1: Set Up Automation in Codex**

Tell Codex:

```
帮我设置一个自动化任务，每 2 天运行一次医学文献管线。
```

Codex will call the `automation_update` tool to create a cron automation task that runs the pipeline on schedule.

**Method 2: Manual Automation Setup**

In Codex's Automation panel:
1. Click "Create Automation"
2. Set a name (e.g., "Medical Literature Pipeline")
3. Set schedule (e.g., `FREQ=DAILY;INTERVAL=2` for every 2 days)
4. Set working directory to project root
5. Set prompt to `"运行医学文献管线"`

**About the Interval Gate:**
- Runs once every 2 days by default (`RESEARCH_OS_RUN_INTERVAL_DAYS=2`)
- Can be forced to run immediately by setting `FORCE_RESEARCH_OS_RUN=true` in `.env`
- Interval logic uses `Asia/Shanghai` timezone with 15:00 planned slot semantics

---

## ✨ 核心特色

- **四阶段管线** — 入库 → 写回 Zotero → 翻译回填 → 报表导出，每阶段有严格的门禁检查
- **双重学习机制** — Excel 反馈（规则引擎）+ docx 评价（LLM 理解），两种方式互补
- **智能偏好学习** — LLM 理解你在 docx 评价区写的中文意见，自动生成规则修改建议
- **筛选标准管理** — screening_standards.md 自动生成、规则建议表、变更追踪
- **增强分级引擎** — 硬排除规则、多关键词维度、期刊白名单
- **写回池去重** — 避免重复写入 Zotero，自动检测已有条目
- **偏好学习审计** — 完整的证据链追踪，每次学习都有据可查
- **Zotero 无缝集成** — 通过 Zotero MCP 插件自动创建文献条目、归类到每日收藏夹
- **隔日自动报表** — 每两天出一份 隔日报.xlsx，A/B/C 三级文献一目了然
- **双周综合报表** — 每两周生成一份 `双周报-*.docx` 汇总报告，方便回顾趋势
- **标题自动翻译** — A/B/C 级文献自动翻译成中文标题，方便中文用户快速浏览
---

## 🧩 六个 Skill

| Skill | 作用 | 一句话说明 |
|---|---|---|
| med-stage-orchestrator | 四阶段编排 | 保证 Stage1→2→3→4 顺序执行，上游失败则下游不跑 |
| med-entry-parallel | 并行入库 | RSS + PubMed/PMC 同时拉取，合并去重 |
| med-query-learning | 反馈学习 | 从上一期 Excel 反馈和 docx 评价中学习，调整搜索策略和筛选规则 |
| med-daily-triage | 每日分级 | 按关键词、期刊、反馈信号把文献分 A/B/C/D 四级 |
| med-zotero-bridge | Zotero 写回 | 自动在 Zotero 创建文献条目、归类到每日收藏夹 |
| med-weekly-synthesis | 双周综合 | 生成 隔日报.xlsx 和 双周报-*.docx |

---

## 🚀 快速上手（6 步）

### Step 1: 安装前置依赖

| 依赖 | 用途 | 安装方式 |
|---|---|---|
| [Zotero](https://www.zotero.org/) | 文献管理工具 | 下载安装即可 |
| [Zotero MCP Plugin](https://github.com/your-zotero-mcp-plugin) | 让 Codex 读写你的 Zotero 库 | 在 Zotero 插件管理器中安装 |
| [Zotero Style](https://github.com/muisedman/Zotero-Style) | 文献评分/星标功能（可选） | 在 Zotero 插件管理器中安装 |
| [Node.js](https://nodejs.org/) >= 18 | 运行管线脚本 | `brew install node` 或官网下载 |
| [PowerShell 7](https://github.com/PowerShell/PowerShell) >= 7.0 | 跨平台脚本执行 | `brew install powershell` 或官网下载 |
| [Codex Desktop](https://github.com/openai/codex) | AI 编程助手，运行管线的入口 | 下载安装即可 |

### Step 2: 克隆项目

```bash
git clone https://github.com/Chip-G0202/zotero-med-pipeline.git
cd zotero-med-pipeline
```

### Step 3: 配置环境变量

复制环境变量模板：

```bash
cp .env.example .env
```

编辑 `.env` 文件，填入你的配置：

```env
# ── 必填 ──────────────────────────────────────────────
# Zotero MCP 插件的 API Key（在 Zotero MCP 插件设置中获取）
ZOTERO_API_KEY=your_zotero_api_key_here

# 你的 Zotero 用户或群组库 ID
ZOTERO_LIBRARY_ID=your_zotero_library_id_here

# 库类型：个人库填 user，群组库填 group
ZOTERO_LIBRARY_TYPE=user_or_group

# Zotero MCP 服务地址（本地服务通常为 http://127.0.0.1:<PORT>/mcp）
# 请根据你的 Zotero MCP 插件实际监听端口修改，以下为默认示例：
ZOTERO_MCP_URL=http://127.0.0.1:23120/mcp
ZOTERO_MCP_BASE_URL=http://127.0.0.1:23120

# ── 翻译 API（可选）──────────────────────────────────
# 标题翻译使用的 OpenAI 兼容接口
# 如果不填，跳过翻译，直接使用英文标题
TITLE_TRANSLATION_API_KEY=YOUR_API_KEY
TITLE_TRANSLATION_ENDPOINT=YOUR_ENDPOINT
TITLE_TRANSLATION_MODEL=YOUR_MODEL

# ── 其他（通常无需修改）────────────────────────────────
# Zotero 可执行文件路径（通常可省略，系统会自动检测）
# Windows 示例：ZOTERO_EXE=D:/Zotero/zotero.exe 或 C:/Program Files/Zotero/zotero.exe
# macOS 示例：  ZOTERO_EXE=/Applications/Zotero.app（或 /Applications/Zotero.app/Contents/MacOS/zotero）
# ZOTERO_EXE=

# PWSH_PATH=pwsh
# FORCE_RESEARCH_OS_RUN=true  # Set to true to force immediate run, ignoring interval
```

**Variable Details:**

| Variable | Required | Description |
|---|---|---|
| `TITLE_TRANSLATION_API_KEY` | Optional | Title translation API key (OpenAI-compatible interface). Skips if empty, uses English titles |
| `PREFERENCE_LEARNING_API_KEY` | Optional | Preference learning LLM API key. Falls back to translation key. If both empty, docx evaluation feedback not automatically processed |
| `ZOTERO_MCP_URL` | Optional | Zotero MCP address. Default: `http://127.0.0.1:23120/mcp`. **Note:** This is the default port for the Zotero MCP plugin. If your plugin uses a different port, please update accordingly. |
| `ZOTERO_EXE` | Optional | Zotero executable path. The system attempts to auto-detect the path based on your platform. Only set this if auto-detection fails or you have multiple Zotero installations. |
| `PWSH_PATH` | Optional | PowerShell 7 path, default `pwsh` |
| `FORCE_RESEARCH_OS_RUN` | Optional | Set to `true` to force immediate run, ignoring 2-day interval |

---

**Cross-Platform Configuration Notes:**

- **Windows:**
  - The default candidate for `ZOTERO_EXE` is `D:/Zotero/zotero.exe`. If your Zotero is installed elsewhere (e.g., `C:/Program Files/Zotero/zotero.exe`), please set `ZOTERO_EXE` in your `.env` file.
- **macOS:**
  - You can usually leave `ZOTERO_EXE` empty. The system will attempt to launch Zotero by application name (e.g., `open -a Zotero`).
  - If auto-detection fails, you can set `ZOTERO_EXE=/Applications/Zotero.app` or the full path to the executable.
- **Linux:**
  - If Zotero is in your system's `PATH`, you can usually leave `ZOTERO_EXE` empty.
  - Otherwise, set `ZOTERO_EXE=/path/to/your/zotero`.
- **ZOTERO_MCP_URL:**
  - This is the address of the local MCP service provided by the Zotero MCP plugin.
  - The default is `http://127.0.0.1:23120/mcp`.
  - If your Zotero MCP plugin is configured to use a different port, please update this value.

---

### Step 4: Configure Search Sources and Screening Standards

#### 4.1 RSS Subscriptions (`config/rss_sources.json`)

Add the RSS feed URLs of journals you follow:

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

**Field Description:**
- `name`: Journal name (anything you like, for display)
- `url`: RSS feed URL (find the RSS icon on the journal website, right-click to copy link)
- `enabled`: `true` = enabled, `false` = temporarily disabled

**How to find RSS URLs?**
1. Open the journal website
2. Find the RSS icon (orange square) or search "RSS"
3. Right-click to copy the link address
4. Paste into the `url` field

#### 4.2 PubMed Search Strategy (`config/pubmed_pmc_search.json`)

Configure your PubMed search keywords:

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

**Field Description:**
- `days_back`: How many days back to search (default 7)
- `retmax`: Maximum number of results (default 300)
- `query`: Direct PubMed search expression (if filled, keyword_groups is ignored)
- `keyword_groups.required`: Must-contain keywords (OR within groups, AND between groups)
- `keyword_groups.optional`: Optional keywords (adds score if present)
- `keyword_groups.negative`: Excluded keywords

**How to write PubMed search expressions?**
1. Go to [PubMed](https://pubmed.ncbi.nlm.nih.gov/)
2. Enter keywords in the search box to test
3. After finding a satisfactory expression, click "Advanced" to view the full expression
4. Copy to the `query` field


#### 4.3 Screening Standards (`screening_standards.md`)

This is your core screening rules file. The pipeline uses these rules to grade literature into A/B/C/D.

**File Structure:**
- `## 优先关注` (Priority Focus): Your most important research directions (each line starts with `*`)
- `## 相对降权` (Demote): Research types you want to deprioritize
- `## 严格排除` (Strict Exclude): Rules for direct exclusion
- `## 不确定边界` (Uncertain Boundaries): Conflicting feedback cases

**Example:**
```markdown
## 优先关注

* Prioritize clinical studies and basic research related to [your research direction].
* Prioritize randomized controlled trials and high-quality cohort studies.
* Prioritize studies with clear biomarkers or molecular mechanisms.

## 相对降权

* Demote studies with small sample sizes or lack of control groups.
* Demote purely descriptive case reports without mechanistic exploration.
* Demote pure basic research far from clinical translation.

## 严格排除

* Exclude research completely unrelated to medicine (e.g., pure physics, pure engineering).
* Exclude methodological papers without substantial medical insights.
```

> 💡 **Tip**: If `screening_standards.md` doesn't exist on first run, the pipeline will automatically create a default version. Manual customization is recommended to fit your research direction.

#### 4.4 Grading Rules (`config/workflow_rules.json`)

Defines the A/B/C/D four-level keyword weights and thresholds.

**Sections to modify:**
- `terms.pollutant`: Exposure factor keywords relevant to your research
- `terms.core_topic`: Your core research direction keywords
- `journal_whitelist`: Journals you follow

**Other fields (usually no need to change):**
- `weights`: Weight for each keyword dimension
- `thresholds`: Score thresholds for A/B/C/D levels

#### 4.5 Translation Configuration (`config/title_translation.config.json`)

Translation API parameter configuration, usually defaults are fine:

```json
{
  "model": "your-model-name",
  "temperature": 0.2,
  "batch_size": 10,
  "fallback_to_english": true
}
```

**Adjustable Parameters:**
- `model`: Translation model name (fill in your model)
- `batch_size`: How many items per batch (higher = faster, but more API pressure)
- `fallback_to_english`: Whether to use English title as fallback when translation fails (recommended to keep `true`)

#### 4.6 Preference Learning Configuration (`config/preference_learning.config.json`)

LLM preference learning parameter configuration, usually defaults are fine:

```json
{
  "model": "your-model-name",
  "temperature": 0.2,
  "max_retries": 2,
  "prompt_file": "prompts/preference_learning.md"
}
```

**Adjustable Parameters:**
- `model`: Preference learning model name (fill in your model)
- `temperature`: Generation temperature (lower = more conservative, higher = more random)
- `max_retries`: Number of retry attempts on failure

### Step 5: First Run

1. Open Codex Desktop
2. Drag this project folder into the Codex workspace
3. Tell Codex: **"运行医学文献管线"**

Codex will automatically execute all stages in sequence, generating `隔日报.xlsx` under `research_os/文献评价/`.

### Step 6: Configure Automation

The pipeline has a built-in 2-day interval gate (runs once every 2 days by default). You can set up automated tasks through Codex's Automation feature.

**Method 1: Set Up Automation in Codex**

Tell Codex:

```
帮我设置一个自动化任务，每 2 天运行一次医学文献管线。
```

Codex will call the `automation_update` tool to create a cron automation task that runs the pipeline on schedule.

**Method 2: Manual Automation Setup**

In Codex's Automation panel:
1. Click "Create Automation"
2. Set a name (e.g., "Medical Literature Pipeline")
3. Set schedule (e.g., `FREQ=DAILY;INTERVAL=2` for every 2 days)
4. Set working directory to project root
5. Set prompt to `"运行医学文献管线"`

**About the Interval Gate:**
- Runs once every 2 days by default (`RESEARCH_OS_RUN_INTERVAL_DAYS=2`)
- Can be forced to run immediately by setting `FORCE_RESEARCH_OS_RUN=true` in `.env`
- Interval logic uses `Asia/Shanghai` timezone with 15:00 planned slot semantics

---

## 📖 这是什么？

### 为什么要做这个

作为一个医学研究者，每周都要花大量时间做同一件事：

- 打开一堆综合性期刊（Nature、Science、Cell……），在一堆物理、化学、天文文章里翻找医学相关的研究
- 即使在医学期刊里，和自己细分方向真正相关的也就一小部分，大部分一眼扫过就关了
- 手动检索 PubMed、逐个看标题摘要、判断要不要精读——重复、枯燥、低效

于是有了这个项目。

### 怎么做的

设计思路和管线逻辑由我构思，具体代码由 [Codex](https://github.com/openai/codex) 生成——一个医学研究者 + AI 编程助手的协作产物。

### 能做什么

**Zotero Med Pipeline** 自动完成从文献发现到整理的全流程：

```text
RSS 订阅 / PubMed 检索  →  去重合并  →  AI 分级(A/B/C/D)  →  写回 Zotero  →  标题翻译  →  导出 Excel 报表
```

每天打开 Codex 说一句话，它自动跑完整条管线，你只需要打开 Excel 看结果。

### 有什么优势

- **不用再翻期刊目录** — RSS 自动抓取，PubMed 定时检索，文献自己找上门
- **不用再逐个筛标题** — AI 按你的研究方向自动分 A/B/C/D 四级，重点看 A 和 B
- **越用越懂你** — 在 Excel 里标 keep/drop/upgrade/downgrade，它会学习你的偏好，下次搜得更准
- **会理解你的评价** — 在 screening_standards.docx 里写中文意见，LLM 会自动帮你修改筛选规则
- **和 Zotero 无缝衔接** — 分级结果直接写入 Zotero，归类到每日收藏夹，PDF 拖进去就能读
- **中文标题一目了然** — A/B/C 级文献自动翻译中文标题，浏览效率翻倍

---

## ✨ 核心特色

- **四阶段管线** — 入库 → 写回 Zotero → 翻译回填 → 报表导出，每阶段有严格的门禁检查
- **双重学习机制** — Excel 反馈（规则引擎）+ docx 评价（LLM 理解），两种方式互补
- **智能偏好学习** — LLM 理解你在 docx 评价区写的中文意见，自动生成规则修改建议
- **筛选标准管理** — screening_standards.md 自动生成、规则建议表、变更追踪
- **增强分级引擎** — 硬排除规则、多关键词维度、期刊白名单
- **写回池去重** — 避免重复写入 Zotero，自动检测已有条目
- **偏好学习审计** — 完整的证据链追踪，每次学习都有据可查
- **Zotero 无缝集成** — 通过 Zotero MCP 插件自动创建文献条目、归类到每日收藏夹
- **隔日自动报表** — 每两天出一份 隔日报.xlsx，A/B/C 三级文献一目了然
- **双周综合报表** — 每两周生成一份 `双周报-*.docx` 汇总报告，方便回顾趋势
- **标题自动翻译** — A/B/C 级文献自动翻译成中文标题，方便中文用户快速浏览
---

## 🧩 六个 Skill

| Skill | 作用 | 一句话说明 |
|---|---|---|
| med-stage-orchestrator | 四阶段编排 | 保证 Stage1→2→3→4 顺序执行，上游失败则下游不跑 |
| med-entry-parallel | 并行入库 | RSS + PubMed/PMC 同时拉取，合并去重 |
| med-query-learning | 反馈学习 | 从上一期 Excel 反馈和 docx 评价中学习，调整搜索策略和筛选规则 |
| med-daily-triage | 每日分级 | 按关键词、期刊、反馈信号把文献分 A/B/C/D 四级 |
| med-zotero-bridge | Zotero 写回 | 自动在 Zotero 创建文献条目、归类到每日收藏夹 |
| med-weekly-synthesis | 双周综合 | 生成 隔日报.xlsx 和 双周报-*.docx |

---

## 🚀 快速上手（6 步）

### Step 1: 安装前置依赖

| 依赖 | 用途 | 安装方式 |
|---|---|---|
| [Zotero](https://www.zotero.org/) | 文献管理工具 | 下载安装即可 |
| [Zotero MCP Plugin](https://github.com/your-zotero-mcp-plugin) | 让 Codex 读写你的 Zotero 库 | 在 Zotero 插件管理器中安装 |
| [Zotero Style](https://github.com/muisedman/Zotero-Style) | 文献评分/星标功能（可选） | 在 Zotero 插件管理器中安装 |
| [Node.js](https://nodejs.org/) >= 18 | 运行管线脚本 | `brew install node` 或官网下载 |
| [PowerShell 7](https://github.com/PowerShell/PowerShell) >= 7.0 | 跨平台脚本执行 | `brew install powershell` 或官网下载 |
| [Codex Desktop](https://github.com/openai/codex) | AI 编程助手，运行管线的入口 | 下载安装即可 |

### Step 2: 克隆项目

```bash
git clone https://github.com/Chip-G0202/zotero-med-pipeline.git
cd zotero-med-pipeline
```

### Step 3: 配置环境变量

复制环境变量模板：

```bash
cp .env.example .env
```

编辑 `.env` 文件，填入你的配置：

```env
# ── 必填 ──────────────────────────────────────────────
# Zotero MCP 插件的 API Key（在 Zotero MCP 插件设置中获取）
ZOTERO_API_KEY=your_zotero_api_key_here

# 你的 Zotero 用户或群组库 ID
ZOTERO_LIBRARY_ID=your_zotero_library_id_here

# 库类型：个人库填 user，群组库填 group
ZOTERO_LIBRARY_TYPE=user_or_group

# Zotero MCP 服务地址（本地服务通常为 http://127.0.0.1:<PORT>/mcp）
# 请根据你的 Zotero MCP 插件实际监听端口修改，以下为默认示例：
ZOTERO_MCP_URL=http://127.0.0.1:23120/mcp
ZOTERO_MCP_BASE_URL=http://127.0.0.1:23120

# ── 翻译 API（可选）──────────────────────────────────
# 标题翻译使用的 OpenAI 兼容接口
# 如果不填，跳过翻译，直接使用英文标题
TITLE_TRANSLATION_API_KEY=YOUR_API_KEY
TITLE_TRANSLATION_ENDPOINT=YOUR_ENDPOINT
TITLE_TRANSLATION_MODEL=YOUR_MODEL

# ── 其他（通常无需修改）────────────────────────────────
# Zotero 可执行文件路径（通常可省略，系统会自动检测）
# Windows 示例：ZOTERO_EXE=D:/Zotero/zotero.exe 或 C:/Program Files/Zotero/zotero.exe
# macOS 示例：  ZOTERO_EXE=/Applications/Zotero.app（或 /Applications/Zotero.app/Contents/MacOS/zotero）
# ZOTERO_EXE=

# PWSH_PATH=pwsh
# FORCE_RESEARCH_OS_RUN=true  # Set to true to force immediate run, ignoring interval
```

**Variable Details:**

| Variable | Required | Description |
|---|---|---|
| `TITLE_TRANSLATION_API_KEY` | Optional | Title translation API key (OpenAI-compatible interface). Skips if empty, uses English titles |
| `PREFERENCE_LEARNING_API_KEY` | Optional | Preference learning LLM API key. Falls back to translation key. If both empty, docx evaluation feedback not automatically processed |
| `ZOTERO_MCP_URL` | Optional | Zotero MCP address. Default: `http://127.0.0.1:23120/mcp`. **Note:** This is the default port for the Zotero MCP plugin. If your plugin uses a different port, please update accordingly. |
| `ZOTERO_EXE` | Optional | Zotero executable path. The system attempts to auto-detect the path based on your platform. Only set this if auto-detection fails or you have multiple Zotero installations. |
| `PWSH_PATH` | Optional | PowerShell 7 path, default `pwsh` |
| `FORCE_RESEARCH_OS_RUN` | Optional | Set to `true` to force immediate run, ignoring 2-day interval |

---

**Cross-Platform Configuration Notes:**

- **Windows:**
  - The default candidate for `ZOTERO_EXE` is `D:/Zotero/zotero.exe`. If your Zotero is installed elsewhere (e.g., `C:/Program Files/Zotero/zotero.exe`), please set `ZOTERO_EXE` in your `.env` file.
- **macOS:**
  - You can usually leave `ZOTERO_EXE` empty. The system will attempt to launch Zotero by application name (e.g., `open -a Zotero`).
  - If auto-detection fails, you can set `ZOTERO_EXE=/Applications/Zotero.app` or the full path to the executable.
- **Linux:**
  - If Zotero is in your system's `PATH`, you can usually leave `ZOTERO_EXE` empty.
  - Otherwise, set `ZOTERO_EXE=/path/to/your/zotero`.
- **ZOTERO_MCP_URL:**
  - This is the address of the local MCP service provided by the Zotero MCP plugin.
  - The default is `http://127.0.0.1:23120/mcp`.
  - If your Zotero MCP plugin is configured to use a different port, please update this value.

---

### Step 4: Configure Search Sources and Screening Standards

#### 4.1 RSS Subscriptions (`config/rss_sources.json`)

Add the RSS feed URLs of journals you follow:

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

**Field Description:**
- `name`: Journal name (anything you like, for display)
- `url`: RSS feed URL (find the RSS icon on the journal website, right-click to copy link)
- `enabled`: `true` = enabled, `false` = temporarily disabled

**How to find RSS URLs?**
1. Open the journal website
2. Find the RSS icon (orange square) or search "RSS"
3. Right-click to copy the link address
4. Paste into the `url` field

#### 4.2 PubMed Search Strategy (`config/pubmed_pmc_search.json`)

Configure your PubMed search keywords:

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

**Field Description:**
- `days_back`: How many days back to search (default 7)
- `retmax`: Maximum number of results (default 300)
- `query`: Direct PubMed search expression (if filled, keyword_groups is ignored)
- `keyword_groups.required`: Must-contain keywords (OR within groups, AND between groups)
- `keyword_groups.optional`: Optional keywords (adds score if present)
- `keyword_groups.negative`: Excluded keywords

**How to write PubMed search expressions?**
1. Go to [PubMed](https://pubmed.ncbi.nlm.nih.gov/)
2. Enter keywords in the search box to test
3. After finding a satisfactory expression, click "Advanced" to view the full expression
4. Copy to the `query` field


#### 4.3 Screening Standards (`screening_standards.md`)

This is your core screening rules file. The pipeline uses these rules to grade literature into A/B/C/D.

**File Structure:**
- `## 优先关注` (Priority Focus): Your most important research directions (each line starts with `*`)
- `## 相对降权` (Demote): Research types you want to deprioritize
- `## 严格排除` (Strict Exclude): Rules for direct exclusion
- `## 不确定边界` (Uncertain Boundaries): Conflicting feedback cases

**Example:**
```markdown
## 优先关注

* Prioritize clinical studies and basic research related to [your research direction].
* Prioritize randomized controlled trials and high-quality cohort studies.
* Prioritize studies with clear biomarkers or molecular mechanisms.

## 相对降权

* Demote studies with small sample sizes or lack of control groups.
* Demote purely descriptive case reports without mechanistic exploration.
* Demote pure basic research far from clinical translation.

## 严格排除

* Exclude research completely unrelated to medicine (e.g., pure physics, pure engineering).
* Exclude methodological papers without substantial medical insights.
```

> 💡 **Tip**: If `screening_standards.md` doesn't exist on first run, the pipeline will automatically create a default version. Manual customization is recommended to fit your research direction.

#### 4.4 Grading Rules (`config/workflow_rules.json`)

Defines the A/B/C/D four-level keyword weights and thresholds.

**Sections to modify:**
- `terms.pollutant`: Exposure factor keywords relevant to your research
- `terms.core_topic`: Your core research direction keywords
- `journal_whitelist`: Journals you follow

**Other fields (usually no need to change):**
- `weights`: Weight for each keyword dimension
- `thresholds`: Score thresholds for A/B/C/D levels

#### 4.5 Translation Configuration (`config/title_translation.config.json`)

Translation API parameter configuration, usually defaults are fine:

```json
{
  "model": "your-model-name",
  "temperature": 0.2,
  "batch_size": 10,
  "fallback_to_english": true
}
```

**Adjustable Parameters:**
- `model`: Translation model name (fill in your model)
- `batch_size`: How many items per batch (higher = faster, but more API pressure)
- `fallback_to_english`: Whether to use English title as fallback when translation fails (recommended to keep `true`)

#### 4.6 Preference Learning Configuration (`config/preference_learning.config.json`)

LLM preference learning parameter configuration, usually defaults are fine:

```json
{
  "model": "your-model-name",
  "temperature": 0.2,
  "max_retries": 2,
  "prompt_file": "prompts/preference_learning.md"
}
```

**Adjustable Parameters:**
- `model`: Preference learning model name (fill in your model)
- `temperature`: Generation temperature (lower = more conservative, higher = more random)
- `max_retries`: Number of retry attempts on failure

### Step 5: First Run

1. Open Codex Desktop
2. Drag this project folder into the Codex workspace
3. Tell Codex: **"运行医学文献管线"**

Codex will automatically execute all stages in sequence, generating `隔日报.xlsx` under `research_os/文献评价/`.

### Step 6: Configure Automation

The pipeline has a built-in 2-day interval gate (runs once every 2 days by default). You can set up automated tasks through Codex's Automation feature.

**Method 1: Set Up Automation in Codex**

Tell Codex:

```
帮我设置一个自动化任务，每 2 天运行一次医学文献管线。
```

Codex will call the `automation_update` tool to create a cron automation task that runs the pipeline on schedule.

**Method 2: Manual Automation Setup**

In Codex's Automation panel:
1. Click "Create Automation"
2. Set a name (e.g., "Medical Literature Pipeline")
3. Set schedule (e.g., `FREQ=DAILY;INTERVAL=2` for every 2 days)
4. Set working directory to project root
5. Set prompt to `"运行医学文献管线"`

**About the Interval Gate:**
- Runs once every 2 days by default (`RESEARCH_OS_RUN_INTERVAL_DAYS=2`)
- Can be forced to run immediately by setting `FORCE_RESEARCH_OS_RUN=true` in `.env`
- Interval logic uses `Asia/Shanghai` timezone with 15:00 planned slot semantics

---

## ⭐ 星标迁移功能（可选）

本功能依赖 [Zotero Style](https://github.com/muisedman/Zotero-Style) 插件，可以将你标记为高星（4-5 星）的文献自动迁移到 \值得精读\ 收藏夹。

### 配置 Zotero Style 插件

1. **安装插件**：从 [Zotero Style Releases](https://github.com/muisedman/Zotero-Style/releases) 下载最新 \.xpi\ 文件，在 Zotero 中通过 \工具 → 插件 → Install Add-on From File\ 安装。

2. **启用评分功能**：安装后，在 Zotero 文献列表中会出现评分列（星星图标）。你可以直接点击星星为文献打分（1-5 星）。

3. **评分方式**：
   - 鼠标点击星星：直接设置 1-5 星
   - 快捷键：选中文献后，按数字键 \1\-\5\ 设置星级，按 \ \ 清除评分

### 管线如何使用星标

管线会在每次运行时检查最近 N 天内（默认 7 天）写入 Zotero 的文献，如果发现某篇文献被你标记为 4 星或以上，会自动将其从当日收藏夹迁移到 \值得精读\ 顶级收藏夹。

**环境变量配置**（在 \.env\ 中设置）：

\\\nv
# 星标迁移模式：expand（默认，扫描 A+B+C 级）/ legacy（仅 A+B 级）/ disabled（禁用）
ZOTERO_STAR_MIGRATION_MODE=expand

# 扫描窗口：检查最近多少天内的文献（默认 7）
ZOTERO_STAR_MIGRATION_WINDOW_DAYS=7

# 最低星级阈值：达到多少星才迁移（默认 4，范围 1-5）
ZOTERO_STAR_MIGRATION_MIN_STARS=4
\\\

**迁移流程**：
1. 管线扫描最近写入的文献
2. 找到星级 ≥ 阈值的文献
3. 将其添加到 \值得精读\ 收藏夹
4. 从原日期收藏夹和分级收藏夹中移除（保持整洁）

---

## 🙏 致谢

- [Zotero](https://www.zotero.org/) — 优秀的开源文献管理工具
- [Zotero Style](https://github.com/muisedman/Zotero-Style) — 提供文献评分/星标功能，让星标迁移成为可能
- [Zotero MCP](https://github.com/your-zotero-mcp-plugin) — 提供与 Zotero 的 MCP 集成能力
- [Codex](https://github.com/openai/codex) — AI 编程助手，本项目的代码生成工具
- [Ollama](https://ollama.ai/) — 本地大语言模型服务，用于语义复审功能
