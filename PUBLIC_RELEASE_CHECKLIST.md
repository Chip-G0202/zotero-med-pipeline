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
