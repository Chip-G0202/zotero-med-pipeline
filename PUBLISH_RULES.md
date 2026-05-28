# GitHub 发布工作流规则

> 本文件记录当前会话中用户要求的发布流程准则。非项目文档，仅供 Agent 会话内参照。

## 发布流程

1. 用户要求推送更新时，先把本地最新文件复制到 `public_release/` 目录
2. 在 `public_release/` 目录下进行脱敏处理（替换个人路径、API 端点、模型名、研究方向关键词等）
3. 本地文件全程不动，不受任何影响
4. 脱敏完成后等待用户确认
5. 用户确认后，从 `public_release/` 推送到 GitHub

## 脱敏规则

以下内容必须替换为通用占位符：

| 敏感项 | 替换为 |
|---|---|
| `D:/Zotero/zotero.exe` | `<ZOTERO_EXE_PATH>` 或环境变量默认值 |
| `E:\zotero\zotero.sqlite` | `<ZOTERO_SQLITE_PATH>` |
| `xiaomimimo.com` API 端点 | `<YOUR_TRANSLATION_ENDPOINT>` |
| `mimo-v2.5-pro` / `mimo-v2-flash` 模型名 | `<YOUR_TRANSLATION_MODEL>` |
| 个人研究方向关键词（如 microplastic, PFAS, neuroinflammation 等） | 通用示例关键词 |

## 目录约定

- 本地工作目录：`C:\Users\GaoChen\Documents\Zotero MCP`
- 脱敏发布目录：`C:\Users\GaoChen\Documents\Zotero MCP\public_release`
- GitHub 仓库：`Chip-G0202/zotero-med-pipeline`
