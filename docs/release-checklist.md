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

## PaperEcho v2.1 Release Candidate

已验证范围：

- RSS/Atom 使用 `fast-xml-parser`，支持 ETag、Last-Modified 和 304；PubMed/PMC 支持完整分页、分块详情及 EDAT/CRDT 重叠获取；OpenAlex 支持 cursor paging 和免费日期重叠路径。
- source state 按 profile/source/canonical query hash 隔离，只有 retrieval artifact 原子落盘后才提交水位。
- Recovery 提供 operation ledger、`--resume <runId>`、reconciliation、conflict protection 和 lease。
- Stage1–4 使用独立失败通知；receipt 状态为 `pending/accepted/unknown/failed`，采用稳定 dedupe key/Message-ID，并支持连续两次降级及单次恢复通知。
- Runner 兼容配置 schema v1；schema v2 提供上述可靠性能力。

不包含：v2.2 性能优化、每日 Radar、Weekly queue merge、撤稿/勘误监测、PDF/全文功能。

已知风险：

- 真实来源 smoke 尚未执行：仓库没有已提交的安全窄查询 acceptance 配置。
- 在线 `npm audit --omit=dev --json` 报告 3 个 production-tree advisory（2 moderate、1 high）。high `brace-expansion` 位于 `exceljs -> archiver/readdir-glob -> minimatch` 传递路径；当前 PaperEcho 入口未发现受影响 glob pattern expansion 的可达触发面。`uuid` advisory 对应的受影响 API 未被当前仅使用 `uuid.v4` 的路径调用。v2.1 接受该已知风险，未升级依赖，也未执行 `npm audit fix`；这些 advisory 未被修复。
