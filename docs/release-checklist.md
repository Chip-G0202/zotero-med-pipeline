# Public Release Checklist

- [ ] 全仓库无真实 API key
- [ ] Git 历史无泄露密钥，或已清理并 rotate
- [ ] `.env` 未被提交
- [ ] `.env.example` 已提供
- [ ] 私有配置文件未被提交
- [ ] README 包含安装、配置、运行、安全说明
- [ ] 示例配置可运行到合理的错误提示或 dry-run
- [ ] 日志不会打印密钥
- [ ] 个人路径、邮箱、Zotero 私有 ID 已移除或模板化
- [ ] 缓存、运行输出、论文列表等隐私数据未被提交

## 建议发布前复查命令

- 关键字扫描：`rg -n --hidden "api[_-]?key|token|secret|password|authorization|bearer|cookie|session|sk-" .`
- 路径扫描：`rg -n --hidden "/Users/|C:\\Users\\" .`
- 邮箱扫描：`rg -n --hidden "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}" .`
- Zotero 标识扫描：`rg -n --hidden "library_id|collection_id|zotero.*id" .`

## PaperEcho v2.1 — Reliability Release

状态：开发与本地 release gate 已完成。

### 检索可靠性与来源状态

- RSS 2.0/Atom 使用 `fast-xml-parser` 正式解析 namespace、CDATA 和 entity，并支持 ETag、Last-Modified 与 304。
- PubMed/PMC 支持完整分页、分块详情及 EDAT/CRDT 重叠窗口；OpenAlex 支持 cursor paging 和免费日期重叠获取。
- source state 按 profile/source/canonical query hash 隔离，weekly 与未来 Radar 状态分离；完整分页和 retrieval artifact 原子落盘后才推进水位，部分失败不误推进。
- availability health 与 yield anomaly 独立记录。

### 断点恢复、通知与兼容

- operation ledger 为副作用保存稳定幂等键；`--resume <runId>` 通过原 launcher/Runner 执行 Zotero、shared index 和文件 reconciliation，已验证操作不重复执行。
- 人工修改或 object version 不一致进入 `conflict`；run lease 阻止同一 runId 并发恢复。
- Stage1–4 失败通知独立于 Stage5。receipt 状态为 `pending/accepted/unknown/failed`，使用稳定 dedupe key/Message-ID；accepted 不重发，SMTP 模糊结果按 unknown 保守处理且默认不自动重发。
- 单来源或 LLM 连续两次降级才通知，同一降级周期不重复，恢复只通知一次；系统不会自动停用来源。
- Runner 保持 schema v1 原行为；schema v2 提供可靠性配置，新通知默认关闭，Radar 不会自动启用，也未增加自动迁移工具。

### 已知限制与未包含范围

- 真实 RSS/PubMed/OpenAlex smoke 尚未执行：仓库没有已提交的安全窄查询 acceptance 配置。
- 在线 `npm audit --omit=dev --json` 报告 3 个 production-tree advisory（2 moderate、1 high）。high `brace-expansion` 位于 `exceljs -> archiver/readdir-glob -> minimatch` 传递路径；当前 PaperEcho 入口未发现受影响 glob pattern expansion 的可达触发面。`uuid` advisory 对应的受影响 API 未被当前仅使用 `uuid.v4` 的路径调用。v2.1 接受该已知风险，未升级依赖，也未执行 `npm audit fix`；这些 advisory 未被修复。
- 真实 SMTP、Zotero 写入及其他外部服务副作用未纳入本次 RC 在线验收。
- v2.3 尚未开始；本版本不包含每日 Radar、Weekly queue merge、撤稿/勘误/关注声明监测、PDF 下载、全文分析或内容总结。v2.2 性能优化见下节。

## PaperEcho v2.2 — Performance Release

状态：三路径性能优化与本地 release gate 已完成；真实外部服务验收仍保留为已知风险。

### Web 更省 Zotero 请求

- 过去同一条文献涉及多个集合操作时，可能重复读取当前 Zotero 状态。现在会复用一次读取取得的 object version 与集合状态，计算完整集合并集后再安全批量写入，减少重复读取和不必要的 API round-trip。
- 固定 cold benchmark 的总请求从 511 降至 263，减少 48.5%；其中 reads 从 489 降至 248，writes 从 22 降至 15。候选和最终业务结果没有减少。
- object version guard、collection/conflict protection、批量失败降级和既有写后验证语义均保留；请求下降不是通过少处理文献、少执行 guard、跳过分页或放宽副作用验证取得。

### Local 的 upsert 热点更快

- Local 优先使用自己的内存去重索引，并复用一次身份规范化结果，避免 warm run 对共享记录反复线性扫描。upsert cold hotspot 从 5.666 ms 降至 3.425 ms，改善约 39.5%；warm 从 8.553 ms 降至 2.926 ms，改善约 65.8%。
- 以上是热点内部收益，不是整条 Local 路径的提升百分比。整条路径 cold total median 从 31.638 ms 变为 33.827 ms，约有 6.9% 的 benchmark 波动性回退；warm 从 38.092 ms 变为 36.409 ms，约改善 4.4%。明确收益集中在 upsert 热点。

### Desktop、共享热点与自适应并发

- Desktop benchmark 没有发现稳定、可控、值得承担风险单独修改的路径级热点，因此继续沿用已有批量化和共享实现，没有为了凑性能 commit 强行改动。
- 共享热点优化尝试因收益不稳定而撤回；没有找到稳定、可重复、值得单独提交的共享路径级热点，因此没有制造无效优化。
- Source HTTP、LLM 与 Zotero Web API 分别使用独立的有界自适应并发控制。外部服务出现 429、`Retry-After`、`Backoff`、连续失败或明显延迟恶化时会降低并发，恢复后只缓慢增加，并且不超过既有安全上限。
- 已验证控制行为不增加请求、retry 或 429，且不改变业务结果；没有独立 Before/After 证据证明自适应并发本身显著降低整体 wall time，因此本版本只声明新增受控自适应并发能力。

### 安全更新与部署

- 新增独立的 `paperecho-update` Skill，官方来源固定为 `Chip-G0202/PaperEcho`。最新版只按数值语义版本选择最新 stable tag，不跟随 `main`、预发布 tag 或其他仓库，也不自动 downgrade。
- Windows 与 macOS 每次运行都会重新进行有限范围的安装探测；多个可信候选不会自动选择，可用 `--install-dir` 明确指定。check 是默认行为且不写 live，apply 必须显式请求并通过相同 preflight。
- release 自带的 update contract 区分 managed 程序文件与 persistent 用户状态。`.env`、真实 config、source state、ledger、receipt、lease、artifact、输出和工作文件均受保护；`config/` 中只有明确列出的 example/template 可由 updater 管理。
- managed 文件采用 OLD/LOCAL/NEW 三方保护，本地修改、目标新增文件碰撞或被修改的删除目标都会阻塞升级。活动中的 PaperEcho run、resume/lease 或另一个 updater lock 同样阻塞，updater 不结束进程。
- 目标 stable tag 先进入 staging，并校验官方来源、tag/commit、contract、schema 兼容、依赖和最小语法/import smoke。schema 不兼容时不自动迁移；lockfile 不变时不安装依赖，变化时只允许确定性的 `npm ci`。
- live 修改前建立最小、manifest-backed rollback snapshot；关键失败会恢复 managed 文件与受保护的 tracked persistent 文件，并验证旧版本。只有验证成功才报告已恢复，最近只保留 updater 自己拥有的少量 snapshot。
- `paperecho-update` 是发布与部署能力，不属于 Stage1–5 文献工作流，也不改变检索、分级、Zotero、副作用、resume、ledger、receipt、adaptive concurrency 或 benchmark 语义。

### 正确性、已知风险与未包含范围

- cold/warm 三路径的 canonical business output hash 与 normalized side-effect hash 保持一致；LLM 调用量没有增加。比较器排除 runId、时间戳和临时路径等非业务字段，不以文件字节完全相同作为唯一等价标准。
- literature identity、retrieval results、dedupe、A/B/C grading、metadata、Zotero mutation plan、collections、exports、notification decisions、source watermark 与 schema v1/v2 行为保持不变；v2.1 的 operation ledger、`--resume <runId>`、reconciliation、conflict protection、lease 和 notification receipt 继续有效。
- 真实 Zotero、真实 SMTP、真实生产检索来源以及真实网络限流条件下的 adaptive concurrency 尚未执行 production acceptance；本次 release 不使用生产配置补做压测。
- 当前依赖树仍存在 2 moderate、1 high advisory；本版本未处理依赖升级，未执行 `npm audit fix`，这些 advisory 未被修复。
- v2.3 尚未开始。本版本不包含每日 Radar、Weekly queue merge、撤稿/勘误/关注声明、PDF 下载、全文分析或内容总结。
