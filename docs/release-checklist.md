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
- v2.2 性能优化和 v2.3 尚未开始；本版本不包含每日 Radar、Weekly queue merge、撤稿/勘误/关注声明监测、PDF 下载、全文分析或内容总结。
