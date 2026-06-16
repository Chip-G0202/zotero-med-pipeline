# Preference Learning Contract

本文档定义偏好学习契约（Stage 1 内部能力）。

## 反馈通道

用户可通过两个通道训练系统：

1. **文章级反馈**：`隔日报.xlsx` 中的 `反馈` 列（`keep` / `upgrade` / `drop` / `downgrade`）；`评价` 列为可选辅助上下文
2. **标准文件文本**：`screening_standards.md` 中的文本作为偏好边界的主 rationale 来源

## 三层学习链

每次 `med-query-learning` 运行必须执行完整的细化链：

1. **Evidence 层**：行级 `feedback/title` → 文章方向证据，可选 `comment` 为辅助上下文
2. **Rationale 层**：`screening_standards.md` → 主 rationale 和边界上下文
3. **Cluster 层**：证据 → 偏好簇 → 筛选偏好规则

三层独立可审计，不得合并。

## screening_standards.md

- 位置：`research_os/文献评价/screening_standards.md`
- 是唯一的长期筛选标准来源（非 xlsx store 或二级 markdown 文件）
- 每次运行读取、规范化之前的显示标记（红色 additions 变为纯文本，蓝色删除线 deletions 被移除）
- 新增标准用红色书写；移除标准用蓝色删除线书写
- 如文件缺失，用中文基线标准初始化并继续

## screening_standards.docx

- 作为人工修订显示格式，当前 additions 为红色，deletions 为蓝色删除线
- 最多保留一个固定备份文件（`screening_standards.backup.docx`），每次运行覆盖
- 评价区和 Pending Rule Suggestions 表是可消费工作空间，Stage 1 默认读取并处理
- 评价区只有在 AI 规则改写成功后才清空；AI key 缺失、LLM 失败或校验失败时必须保留原文并记录 blocker
- AI 规则改写密钥优先 `PREFERENCE_LEARNING_API_KEY`，回退 `TITLE_TRANSLATION_API_KEY`；审计只记录 key 是否配置及 direct/fallback 来源，不记录密钥值
- Pending Rule Suggestions 的 `accept/接受`、`reject/拒绝`、`revise/修改` 会被处理并从下一轮 docx 表移除；`pending/待定` 保留

## 证据聚类

- 单行反馈仅为 evidence，不得直接写入为稳定的筛选偏好
- 新证据与现有簇尽可能合并，仅在匹配失败时创建新簇
- 每次运行必须重新计算簇级统计：`evidence_count`、`positive_evidence_count`、`negative_evidence_count`、`confidence`、`status`
- 允许的簇/规则状态：`stable`、`tentative`、`ambiguous`、`needs_more_feedback`
- 单行证据可变为 `tentative` 或 `needs_more_feedback`，但不得变为 `stable`
- 同一主题族的正/负冲突证据必须表示为 `ambiguous`

## 语义偏好细化（弱证据）

- Zotero MCP `semantic_search` 仅用于偏好证据增强
- 语义结果不得扩展当天的候选池
- 语义邻居不是伪标记的反馈样本
- 如果 semantic search 不可用/超时/无效：降级为仅 title+feedback+comment 学习

## 审计要求

每次运行必须输出 `pipeline/preference_learning_audit.json`，包含：
- 前一周期反馈查找路径和文件
- 列检测结果
- 样本计数
- 证据统计（positive/negative/ambiguous/ignored）
- 簇统计（total/created/updated/stable/tentative/ambiguous/needs_more_feedback）
- 偏好变更统计
- screening_standards.md 加载/清理/变更标记状态

## 降级处理

- 如果前一周期反馈文件缺失：降级并记录具体阻塞原因
- 如果 `feedback` 列缺失：在 workbook 读取成功且检测到 headers 后才报告 `feedback_column_missing`
- 如果翻译缺失：回退到英文标题，在学习摘要中标记不确定性
- 负面反馈必须作为条件排除提示学习，不得在无重复证据的情况下广泛拒绝整个主题

详见 `tools/lib/preference_learning_support.mjs` 和 `tools/lib/feedback_learning_support.mjs`。
