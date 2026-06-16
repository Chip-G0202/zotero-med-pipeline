/**
 * OpenAlex API adapter for literature search.
 * Converts keyword_groups to OpenAlex search queries and normalizes results.
 */

/**
 * 将 keyword_groups 转换为 OpenAlex search query
 * @param {Object} keywordGroups - { required: [[term1, term2], [term3]], optional: [...], negative: [...] }
 * @returns {string} OpenAlex search parameter string
 */
export function buildOpenAlexSearchQuery(keywordGroups) {
  if (!keywordGroups || !keywordGroups.required?.length) return "";

  // required 各组之间用 AND 连接，组内用 OR
  const positiveParts = keywordGroups.required
    .filter((group) => Array.isArray(group) && group.length > 0)
    .map((group) => {
      if (group.length === 1) return group[0];
      return `(${group.join(" OR ")})`;
    });

  const positiveQuery = positiveParts.join(" AND ");

  // negative 作为排除词附加在末尾（OpenAlex search 参数不直接支持 NOT，但在 filter 中可用）
  // 这里返回 positive 部分，negative 在 buildOpenAlexUrl 中处理
  return positiveQuery;
}

/**
 * 构建 OpenAlex API URL
 * @param {Object} cfg - 来自 loadPubMedPmcSearchConfig()，包含 query, keyword_groups, minDate, maxDate, retmax
 * @returns {string} 完整 URL 字符串
 */
export function buildOpenAlexUrl(cfg) {
  const baseUrl = "https://api.openalex.org/works";
  const params = new URLSearchParams();

  // search 参数：优先用 cfg.query，否则从 keyword_groups 构建
  let searchQuery = cfg.query || "";
  if (!searchQuery && cfg.keyword_groups) {
    searchQuery = buildOpenAlexSearchQuery(cfg.keyword_groups);
  }
  if (searchQuery) {
    params.set("search", searchQuery);
  }

  // filter 参数：日期范围
  const filters = [];
  if (cfg.minDate) {
    // OpenAlex 日期格式: YYYY-MM-DD
    const minDate = cfg.minDate.replace(/\//g, "-");
    filters.push(`from_publication_date:${minDate}`);
  }
  if (cfg.maxDate) {
    const maxDate = cfg.maxDate.replace(/\//g, "-");
    filters.push(`to_publication_date:${maxDate}`);
  }

  // negative keywords 作为排除过滤器
  if (cfg.keyword_groups?.negative?.length) {
    // OpenAlex 不直接支持 search NOT，但可以用 title.search 来排除
    // 这里使用 filter 的默认_search 来处理
    // 实际上 OpenAlex 的 search 已经支持 NOT 语法
    const negativePart = cfg.keyword_groups.negative
      .map((term) => `NOT "${term}"`)
      .join(" ");
    if (searchQuery) {
      params.set("search", `${searchQuery} ${negativePart}`);
    }
  }

  if (filters.length) {
    params.set("filter", filters.join(","));
  }

  // per_page: OpenAlex 单次最多 200
  const perPage = Math.min(cfg.retmax || 200, 200);
  params.set("per_page", String(perPage));

  // sort: publication_date:desc
  params.set("sort", "publication_date:desc");

  // mailto: 可选，提高速率限制
  if (process.env.OPENALEX_MAILTO) {
    params.set("mailto", process.env.OPENALEX_MAILTO);
  }

  return `${baseUrl}?${params.toString()}`;
}

/**
 * 将 OpenAlex API 返回的 results 数组映射为统一字段格式
 * @param {Array} works - OpenAlex work 对象数组
 * @returns {Array} 标准化的 items 数组
 */
export function normalizeOpenAlexItems(works) {
  if (!Array.isArray(works)) return [];

  return works.map((work) => {
    // 提取 DOI：去掉 https://doi.org/ 前缀
    let doi = work.doi || "";
    if (doi.startsWith("https://doi.org/")) {
      doi = doi.replace("https://doi.org/", "");
    }

    // 提取期刊名
    const journal = work.primary_location?.source?.display_name || "";

    // 提取 landing_page_url
    const landingUrl = work.primary_location?.landing_page_url || "";

    // 还原 abstract
    const abstract = reconstructAbstract(work.abstract_inverted_index);

    // 提取作者名
    const authors = (work.authorships || [])
      .map((a) => a.author?.display_name || "")
      .filter(Boolean)
      .join("; ");

    // 提取 OpenAlex ID
    let openalexId = work.id || "";
    if (openalexId.startsWith("https://openalex.org/")) {
      openalexId = openalexId.replace("https://openalex.org/", "");
    }

    // 构建 URL：优先用 landing_page_url，其次用 DOI URL
    const url = landingUrl || (doi ? `https://doi.org/${doi}` : "");

    return {
      source_channel: "database",
      source_platform: "openalex",
      item_type_hint: "journalArticle",
      title: work.title || "",
      url,
      abstract,
      doi,
      pmid: "",
      pmcid: "",
      journal,
      publicationTitle: journal,
      pubdate: work.publication_year ? String(work.publication_year) : "",
      authors,
      year: work.publication_year || null,
      openalex_id: openalexId,
    };
  });
}

/**
 * 将 abstract_inverted_index 还原为纯文本
 * @param {Object|null} invertedIndex - { "word1": [0, 5, 10], "word2": [1, 6], ... }
 * @returns {string} 还原后的纯文本
 */
export function reconstructAbstract(invertedIndex) {
  if (!invertedIndex || typeof invertedIndex !== "object") return "";

  // 收集所有 (position, word) 对
  const pairs = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    if (!Array.isArray(positions)) continue;
    for (const pos of positions) {
      if (typeof pos === "number") {
        pairs.push({ pos, word });
      }
    }
  }

  // 按 position 排序
  pairs.sort((a, b) => a.pos - b.pos);

  // 拼接为文本
  return pairs.map((p) => p.word).join(" ");
}
