# 用户可编辑配置

这里集中放置用户可直接修改的配置、规则和参数。

- `rss_sources.json`: RSS 订阅源列表。
- `pubmed_pmc_search.json`: PubMed/PMC 检索条件，默认 `days_back` 为 7。
- `workflow_rules.json`: 分级标签、关键词、权重、阈值、期刊白名单和 feedback 语义搜索规则说明。
- `title_translation.config.json`: 标题翻译的非密钥参数。
- `preference_learning.config.json`: `screening_standards.docx` 中文评价理解的非密钥参数；密钥优先读 `PREFERENCE_LEARNING_API_KEY`，缺省回退到 `TITLE_TRANSLATION_API_KEY`。

长期筛选标准正文位于 `research_os/文献评价/screening_standards.md`。`screening_standards.docx` 是人工入口，包含偏好规则、检索关键词和评价三部分。
