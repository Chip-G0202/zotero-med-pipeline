# 跨平台本地验证指南

> 本文档提供 Windows PC 和 macOS 上的逐项验证流程。所有检查默认 dry-run / no-write / read-only，不发送邮件、不写 Zotero、不清理 runs、不调用有副作用 API。

---

## 验证分层

### 第一层：安全基础检查（无需 `.env`，无副作用）

| # | 检查项 | 命令 | 安全 | 需要 `.env` | 联网 | 副作用 |
|---|--------|------|------|------------|------|--------|
| 1 | 语法检查 | `npm run check` | ✅ | 否 | 否 | 无 |
| 2 | 单元测试 | `npm test` | ✅ | 否 | 否 | 无 |
| 3 | smoke check 帮助 | `node workflow/tools/maintenance/smoke_check.mjs --help` | ✅ | 否 | 否 | 无 |
| 4 | headless smoke (dry-run) | `npm run smoke:headless` | ✅ | 否 | 否 | 无 |
| 5 | desktop smoke (dry-run) | `npm run smoke:desktop` | ✅ | 否 | 否 | 无 |
| 6 | runs cleanup dry-run | `node workflow/tools/maintenance/cleanup_runs.mjs` | ✅ | 否 | 否 | 无 |

**通过标准**：
- `npm run check`：所有 .mjs 文件语法通过
- `npm test`：所有测试通过
- smoke check：不崩溃，输出结构化报告，报告中的 "missing" 是预期的（尚未配置 `.env`）
- cleanup dry-run：输出 run 统计，不删除文件

**失败解释**：
- `npm run check` 失败 → 代码语法错误，需修复
- `npm test` 失败 → 测试断言失败，需修复
- smoke check 崩溃 → 脚本 bug，需修复
- smoke check 报告 "has_gaps" → 正常，表示缺少配置而非代码错误

### 第二层：配置检查（需填写 `.env`，仍 no-write）

完成第一层后，复制并填写配置：

```bash
cp .env.example .env
# 按需填写 ZOTERO_API_KEY、PAPERFLOW_REPORT_TO 等变量
# 不要填写真实 secret 到提交版本中
```

| # | 检查项 | 命令 | 安全 | 说明 |
|---|--------|------|------|------|
| 7 | 填写后 headless smoke | `npm run smoke:headless -- --json` | ✅ | 检查 ZOTERO_API_KEY 等是否识别 |
| 8 | 填写后 desktop smoke | `npm run smoke:desktop -- --json` | ✅ | 检查 CLI/EXE/backend 配置 |
| 9 | 全量 smoke | `npm run smoke:workflow -- --json` | ✅ | 聚合所有检查 |
| 10 | runs cleanup dry-run (真实目录) | `node workflow/tools/maintenance/cleanup_runs.mjs --json` | ✅ | 查看真实 runs 统计 |

**通过标准**：
- smoke check 报告 "ready"（所有必需配置齐全）
- 或报告具体缺失变量名（可针对性补充）

**注意**：
- smoke check 不会读取 `.env` 文件内容，只检查 `process.env` 中的变量
- 需要先 `source .env`（macOS）或在 PowerShell 中 `$env:ZOTERO_API_KEY="xxx"` 设置变量
- 或使用 `node workflow/tools/maintenance/smoke_check.mjs`

### 第三层：需人工确认的真实操作（不在默认验证流程中）

以下操作有副作用，**必须显式确认**后才执行：

| # | 操作 | 命令 | 副作用 | 前置条件 |
|---|------|------|--------|----------|
| 11 | 真实发送测试邮件 | 需手动调用邮件发送逻辑 | 发送真实邮件 | 用户自己的 SMTP 配置齐全 |
| 12 | 真实写入 Zotero | 对应路径 launcher `--run`（Desktop 或 Web） | 写入 Zotero 库并执行本次结果验证 | 所选路径配置齐全且用户显式确认 |
| 13 | 真实清理 runs | `node workflow/tools/maintenance/cleanup_runs.mjs --apply` | 删除旧 run 文件 | 先确认 dry-run 摘要 |
| 14 | 外部 API 连通性测试 | 需手动调用 | 产生 API 请求 | API key 配置齐全 |

---

## Windows PC 验证步骤

### 前置要求

- **Shell**：PowerShell 7+（`pwsh`），不支持 Windows PowerShell 5.1
- **Node.js**：>= 18.0.0，从 [nodejs.org](https://nodejs.org) 安装
- **路径注意**：仓库路径包含空格（`Zotero MCP`），命令中需用引号包裹

### 验证步骤

```powershell
# 1. 进入仓库目录
cd "<PROJECT_ROOT>"

# 2. 安装依赖（首次）
npm install

# 3. 语法检查
npm run check

# 4. 单元测试
npm test

# 5. smoke check 帮助
node workflow/tools/maintenance/smoke_check.mjs --help

# 6. headless smoke check（dry-run）
npm run smoke:headless

# 7. desktop smoke check（dry-run）
npm run smoke:desktop

# 8. runs cleanup dry-run
node workflow/tools/maintenance/cleanup_runs.mjs

# 9. （可选）JSON 输出便于脚本处理
npm run smoke:headless -- --json
node workflow/tools/maintenance/cleanup_runs.mjs --json
```

### Windows 常见问题

| 现象 | 原因 | 解决 |
|------|------|------|
| `pwsh` 不识别 | 未安装 PowerShell 7 | 从 GitHub Releases 安装 |
| 路径中文/空格报错 | 未用引号 | `cd "含空格路径"` |
| `npm` 不识别 | Node.js 未加入 PATH | 重新安装 Node.js 或手动添加 PATH |
| smoke check 报 "ZOTERO_API_KEY missing" | 未配置 `.env` | 预期行为，属于第一层检查 |
| CLI 工具 "not found" | 未安装 zotero-cli-cc / cli-anything-zotero | `npm install -g <package>`（仅 desktop 路径需要） |

---

## macOS 验证步骤

### 前置要求

- **Shell**：zsh 或 bash
- **Node.js**：>= 18.0.0，推荐用 `nvm` 或 Homebrew 安装
- **Zotero Desktop**：默认路径 `/Applications/Zotero.app`

### 验证步骤

```bash
# 1. 进入仓库目录
cd ~/Documents/Zotero\ MCP
# 或
cd "$HOME/Documents/Zotero MCP"

# 2. 安装依赖（首次）
npm install

# 3. 语法检查
npm run check

# 4. 单元测试
npm test

# 5. smoke check 帮助
node workflow/tools/maintenance/smoke_check.mjs --help

# 6. headless smoke check（dry-run）
npm run smoke:headless

# 7. desktop smoke check（dry-run）
npm run smoke:desktop

# 8. runs cleanup dry-run
node workflow/tools/maintenance/cleanup_runs.mjs

# 9. （可选）JSON 输出
npm run smoke:headless -- --json
node workflow/tools/maintenance/cleanup_runs.mjs --json
```

### macOS 常见问题

| 现象 | 原因 | 解决 |
|------|------|------|
| `node` 版本过低 | 系统自带旧版 | `nvm install 20` 或 `brew install node` |
| Zotero 路径不同 | 自定义安装 | 设置 `ZOTERO_EXE` 环境变量 |
| CLI 工具 "not found" | 未全局安装 | `npm install -g zotero-cli-cc` 或 `npm install -g cli-anything-zotero` |
| 权限问题 | npm 全局安装权限 | 用 `nvm` 管理 Node 版本避免权限问题 |
| smoke check 报 "has_gaps" | 未配置 `.env` | 预期行为，填写 `.env` 后重试 |

---

## Headless 路径验证

Headless 模式不需要 Zotero Desktop，通过 Zotero Web API 访问文献库。

### 验证流程

```bash
# 1. 确认 headless smoke check 能运行
node workflow/tools/maintenance/smoke_check.mjs --mode headless

# 2. 预期输出：
#   - ZOTERO_API_KEY: MISSING（正常，未配置）
#   - source_selection: OK
#   - config files: OK
#   - overall: has_gaps

# 3. 配置 .env 后重试
# cp .env.example .env
# 填写 ZOTERO_API_KEY
# node workflow/tools/maintenance/smoke_check.mjs --mode headless

# 4. 预期配置后输出：
#   - ZOTERO_API_KEY: configured
#   - overall: ready（如果所有必需变量齐全）
```

### 关键判断

- **"has_gaps" + "ZOTERO_API_KEY missing"** → 正常，只需配置
- **"has_gaps" + 配置文件 "missing"** → 配置文件缺失，需创建
- **脚本崩溃** → 代码 bug，需修复
- **"ready"** → headless 路径配置齐全

### headless 路径不需要

- Zotero Desktop
- CLI 工具安装
- `ZOTERO_EXE` 配置

---

## Desktop 路径验证

Desktop 模式通过 Zotero Desktop + CLI 工具访问文献库。

### 验证流程

```bash
# 1. 确认 desktop smoke check 能运行
node workflow/tools/maintenance/smoke_check.mjs --mode desktop

# 2. 预期输出：
#   - ZOTERO_BACKEND: MISSING
#   - ZOTERO_DESKTOP_CLI_TOOL: MISSING
#   - desktop_cli_installed: false（未安装 CLI）
#   - platform_note: Windows/macOS 相关说明

# 3. smoke check 不会启动 Zotero Desktop，不会写入
```

### CLI 工具说明

| CLI | npm 包 | 命令 | 用途 |
|-----|--------|------|------|
| zotero-cli-cc | `zotero-cli-cc` | `zot` | headless 生态（SQLite + Web API） |
| cli-anything-zotero | `cli-anything-zotero` | `zotero-cli` | desktop 路径（Local API + JS Bridge） |

> **注意**：以上命令语法基于本地代码分析。请按各 CLI 官方 README 最终核对安装和使用方式。

### Desktop 路径需要

- Zotero Desktop 运行中（cli-anything-zotero）
- 或 Zotero Web API key（zotero-cli-cc）
- 对应 CLI 工具安装
- `ZOTERO_BACKEND` 配置

### 写入前必须

1. 先运行 smoke check 确认配置齐全
2. 使用 `--dry-run` 或 `review_results_DRY_RUN=true` 验证
3. 确认无误后才启用真实写入

---

## Email 验证

PaperEcho 不提供邮件中转。首次使用只需配置 `SMTP_HOST`、`SMTP_USER`、`SMTP_PASS`，优先使用邮箱服务商提供的应用专用密码或授权码，并确保本地 `.env` 不提交到 Git。可选 `SMTP_PORT` 默认 465；`SMTP_SECURE` 默认根据端口推导；`SMTP_FROM` 默认使用 `SMTP_USER`。使用 587 时通常只需额外设置 `SMTP_PORT=587`。

### 默认行为

- 不发送真实邮件
- smoke check 只检查 Stage5 recipient 与 SMTP 变量，不连接邮件服务器

### 验证步骤

```bash
# 1. 检查邮件配置（不发送）
node workflow/tools/maintenance/smoke_check.mjs --json | node -e "
  const d = require('fs').readFileSync(0, 'utf8');
  const j = JSON.parse(d);
  console.log('Email ready:', j.email.ready);
  console.log('Checks:', j.email.checks);
"
```

### 真实测试邮件

只有在以下条件全部满足时才允许发送真实测试邮件：

1. 使用者自己的 SMTP 配置齐全
2. 用户明确要求测试
3. 不在自动化验证脚本中默认执行

---

## Runs Cleanup 验证

### 默认行为

- **dry-run**：不删除任何文件
- **保留策略**：最近 2 次运行 + 最近 14 天内运行（任一条件满足即保留）
- **unknown 默认保留**：无法识别日期的 run 不删除

### 验证步骤

```bash
# 1. dry-run 查看摘要
node workflow/tools/maintenance/cleanup_runs.mjs

# 2. JSON 输出
node workflow/tools/maintenance/cleanup_runs.mjs --json

# 3. 自定义参数
node workflow/tools/maintenance/cleanup_runs.mjs --keep-runs 3 --keep-days 21

# 4. 真实清理（需显式确认，不在默认验证中）
# node workflow/tools/maintenance/cleanup_runs.mjs --apply
```

### 干燥运行输出解读

```
pipeline dir:          review_results/pipeline
mode:                  DRY-RUN (no files deleted)  ← 关键：确认是 DRY-RUN
keep-runs:             2
keep-days:             14
total runs:            31
hard-kept runs:        9                          ← 满足保留条件的 run 数
cleanup candidate runs: 22                         ← 可清理的 run 数
cleanable files:       241 (234.9 MB)             ← 可清理的文件数和大小
```

### 注意

- `--apply` 会真实删除文件，先确认 dry-run 摘要
- 只删除可再生成的大型中间产物，保留 report/audit/manifest
- 不要把 `--apply` 放进默认验证流程

---

## E2E Workflow Dry-Run

E2E dry-run 模拟完整工作流的关键阶段，验证配置读取 → source selection → 检索计划 → 报告计划 → 邮件/Zotero readiness 是否能闭环。

### 安全说明

- 默认 dry-run：不调用外部 API、不发送邮件、不写 Zotero、不删除文件
- 使用内置 mock 数据模拟检索和去重
- 只输出计划和配置缺口

### 命令

```bash
# 帮助
node workflow/tools/maintenance/workflow_dry_run.mjs --help

# headless 路径
npm run dry-run:headless

# desktop 路径
npm run dry-run:desktop

# 两条路径聚合
npm run dry-run:workflow -- --mode all

# JSON 输出
npm run dry-run:workflow -- --json
```

### 输出解读

| 字段 | 说明 |
|------|------|
| `overall: ok` | 所有必需配置齐全，可进入真实执行 |
| `overall: has_gaps` | 存在配置缺口，需补充后才能执行 |
| `overall: blocked` | 被阻止（如 require_manual_confirmation=true） |
| `retrievalPlan.sources` | 各检索源的启用状态和配置 |
| `mockDedupe` | 模拟去重结果 |
| `readinessGaps` | 各路径的配置缺口和跳过的操作 |

### 与 smoke check 的区别

| | smoke check | e2e dry-run |
|---|-------------|-------------|
| 目标 | 检查配置齐全性 | 模拟完整工作流计划 |
| 检索模拟 | 无 | 有（mock 数据） |
| 去重模拟 | 无 | 有 |
| 输出 | readiness + hints | retrieval plan + dedupe + gaps |

---
## 快速判定表

| 检查项 | 命令 | 安全 | 需要 `.env` | 联网 | 副作用 | 通过标准 |
|--------|------|------|------------|------|--------|----------|
| 语法检查 | `npm run check` | ✅ | 否 | 否 | 无 | 所有 .mjs 语法通过 |
| 单元测试 | `npm test` | ✅ | 否 | 否 | 无 | 所有测试通过 |
| smoke 帮助 | `smoke_check --help` | ✅ | 否 | 否 | 无 | 显示 Usage |
| headless smoke | `npm run smoke:headless` | ✅ | 否 | 否 | 无 | 不崩溃，输出报告 |
| desktop smoke | `npm run smoke:desktop` | ✅ | 否 | 否 | 无 | 不崩溃，输出报告 |
| cleanup dry-run | `cleanup_runs.mjs` | ✅ | 否 | 否 | 无 | 输出统计，不删除 |
| 配置后 headless | `smoke:headless --json` | ✅ | 是 | 否 | 无 | `overall: ready` |
| 配置后 desktop | `smoke:desktop --json` | ✅ | 是 | 否 | 无 | `overall: ready` |
| 真实邮件 | 手动 | ❌ | 是 | 是 | **发邮件** | 需显式确认 |
| 真实 Zotero 写入 | `stage0/main.mjs` | ❌ | 是 | 是 | **写库** | 需显式确认 |
| 真实 cleanup | `cleanup_runs --apply` | ❌ | 否 | 否 | **删文件** | 需显式确认 |

---

## 相关文档

- [Zotero Backend 使用指南](zotero-backend-guide.md)
- [Zotero CLI 能力矩阵](zotero-cli-capabilities.md)
- [Zotero Readiness Contract](contract-zotero-readiness.md)
- [Runs Cleanup 工具](../workflow/tools/maintenance/cleanup_runs.mjs)
- [Smoke Check 工具](../workflow/tools/maintenance/smoke_check.mjs)
