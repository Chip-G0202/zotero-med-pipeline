/**
 * Zotero Backend Base
 *
 * 所有 Zotero 后端（Web API、CLI）的统一接口定义。
 * 所有方法均为抽象方法，子类必须实现。
 *
 * Collection 写入操作必须包含 verify 机制：
 * - addItemsToCollection 执行后 verify
 * - removeItemsFromCollection 执行后 verify
 * - moveItemsBetweenCollections 拆分为 add + verify + remove + verify
 * - verify 失败时记录到 failures，不中断整批 pipeline
 */

export class ZoteroBackendBase {
  /**
   * 后端类型标识
   * @returns {string}
   */
  get backendType() {
    return "base";
  }

  // ─── 连接管理 ───

  /**
   * 检查后端是否可用
   * @returns {Promise<boolean>}
   */
  async ping() {
    throw new Error("Not implemented: ping");
  }

  /**
   * 确保后端就绪（含重试）
   * @param {Object} options
   * @returns {Promise<{ok: boolean, diagnostics: Object}>}
   */
  async ensureReady(options = {}) {
    throw new Error("Not implemented: ensureReady");
  }

  // ─── 集合读取 ───

  /**
   * 获取集合列表
   * @param {Object} options
   * @param {string} options.mode - "minimal" | "complete"
   * @param {number} options.limit
   * @returns {Promise<Array>}
   */
  async getCollections(options = {}) {
    throw new Error("Not implemented: getCollections");
  }

  /**
   * 获取子集合
   * @param {string} collectionKey
   * @param {boolean} recursive
   * @returns {Promise<Array>}
   */
  async getSubcollections(collectionKey, recursive = false) {
    throw new Error("Not implemented: getSubcollections");
  }

  /**
   * 获取集合中的项目 key 列表
   * @param {string} collectionKey
   * @param {Object} options
   * @param {number} options.limit
   * @param {number} options.offset
   * @returns {Promise<Array>}
   */
  async getCollectionItems(collectionKey, options = {}) {
    throw new Error("Not implemented: getCollectionItems");
  }

  // ─── 集合写入（带 verify） ───

  /**
   * 确保集合路径存在，不存在则创建
   * @param {string[]} pathArray - 集合路径，如 ["文献池", "2026-07-04", "A课题相关"]
   * @param {Object} options
   * @returns {Promise<{created: string[], existing: string[], rootKey: string}>}
   */
  async ensureCollectionPath(pathArray, options = {}) {
    throw new Error("Not implemented: ensureCollectionPath");
  }

  /**
   * 创建集合
   * @param {string} name
   * @param {string|null} parentKey
   * @returns {Promise<Object>} 创建的集合信息
   */
  async createCollection(name, parentKey = null) {
    throw new Error("Not implemented: createCollection");
  }

  /**
   * Ensure the standard Stage2 date/source/grade collection subtree exists.
   * Backends may implement this as one local batch operation.
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async ensureWritebackCollections(options = {}) {
    throw new Error("Not implemented: ensureWritebackCollections");
  }

  /**
   * 删除集合
   * @param {string} collectionKey
   * @param {Object} options
   * @param {boolean} options.deleteItems - 是否同时删除项目
   * @returns {Promise<void>}
   */
  async deleteCollection(collectionKey, options = {}) {
    throw new Error("Not implemented: deleteCollection");
  }

  /**
   * 添加项目到集合（带 verify）
   *
   * 写入策略：
   * 1. 执行 add 操作
   * 2. 重新读取 collection items 做 verify
   * 3. verify 失败时记录到 failures，不中断整批
   *
   * @param {string[]} itemKeys
   * @param {string} collectionKey
   * @param {Object} options
   * @param {boolean} options.verify - 是否验证（默认 true）
   * @param {boolean} options.skipOnVerifyFailure - verify 失败时跳过而非中断（默认 true）
   * @returns {Promise<{added: string[], verified: string[], failed: Array<{itemKey: string, error: string}>}>}
   */
  async addItemsToCollection(itemKeys, collectionKey, options = {}) {
    throw new Error("Not implemented: addItemsToCollection");
  }

  /**
   * 添加多个项目到多个集合（带 verify 可选）
   *
   * @param {Array<{collectionKey: string, itemKeys: string[]}>} operations
   * @param {Object} options
   * @returns {Promise<{added: Array, already: Array, failed: Array}>}
   */
  async addItemsToCollections(operations, options = {}) {
    throw new Error("Not implemented: addItemsToCollections");
  }

  /**
   * 从集合移除项目（带 verify）
   *
   * 写入策略：
   * 1. 执行 remove 操作
   * 2. 重新读取 collection items 做 verify
   * 3. verify 失败时记录到 failures，不中断整批
   *
   * @param {string[]} itemKeys
   * @param {string} collectionKey
   * @param {Object} options
   * @param {boolean} options.verify - 是否验证（默认 true）
   * @param {boolean} options.skipOnVerifyFailure - verify 失败时跳过而非中断（默认 true）
   * @returns {Promise<{removed: string[], verified: string[], failed: Array<{itemKey: string, error: string}>}>}
   */
  async removeItemsFromCollection(itemKeys, collectionKey, options = {}) {
    throw new Error("Not implemented: removeItemsFromCollection");
  }

  /**
   * 验证项目是否在集合中
   *
   * @param {string[]} itemKeys
   * @param {string} collectionKey
   * @param {Object} options
   * @returns {Promise<{success: boolean, present: string[], missing: string[]}>}
   */
  async verifyItemsInCollection(itemKeys, collectionKey, options = {}) {
    throw new Error("Not implemented: verifyItemsInCollection");
  }

  /**
   * 在集合间移动项目（add + verify + remove + verify）
   *
   * 策略：不使用单个 move 命令，拆分为：
   * 1. add 到目标集合 + verify
   * 2. remove 从源集合 + verify
   * 3. 如果 remove 失败，回滚（从目标移除）
   *
   * @param {string[]} itemKeys
   * @param {string} fromCollectionKey
   * @param {string} toCollectionKey
   * @param {Object} options
   * @returns {Promise<{moved: string[], failed: Array<{itemKey: string, error: string}>}>}
   */
  async moveItemsBetweenCollections(itemKeys, fromCollectionKey, toCollectionKey, options = {}) {
    throw new Error("Not implemented: moveItemsBetweenCollections");
  }

  // ─── 项目读取 ───

  /**
   * 获取项目详情
   * @param {string} itemKey
   * @param {string} mode - "preview" | "complete"
   * @returns {Promise<Object>}
   */
  async getItemDetails(itemKey, mode = "preview") {
    throw new Error("Not implemented: getItemDetails");
  }

  /**
   * 搜索库
   * @param {Object} options
   * @param {string} options.q - 搜索关键词
   * @param {string} options.title - 标题搜索
   * @param {string} options.titleOperator - 标题搜索操作符
   * @param {number} options.limit
   * @param {string} options.mode - "preview" | "complete"
   * @param {boolean} options.relevanceScoring
   * @returns {Promise<Array>}
   */
  async searchLibrary(options = {}) {
    throw new Error("Not implemented: searchLibrary");
  }

  // ─── 项目写入 ───

  /**
   * 创建项目
   * @param {Object} itemData
   * @returns {Promise<Object>}
   */
  async createItem(itemData) {
    throw new Error("Not implemented: createItem");
  }

  /**
   * 批量创建项目
   * @param {Object[]} itemsData
   * @returns {Promise<{created: Array, failed: Array}>}
   */
  async createItems(itemsData = []) {
    throw new Error("Not implemented: createItems");
  }

  /**
   * 删除项目
   * @param {string[]} itemKeys
   * @returns {Promise<{deleted: string[], failed: Array}>}
   */
  async deleteItems(itemKeys = []) {
    throw new Error("Not implemented: deleteItems");
  }

  /**
   * 更新项目
   * @param {string} itemKey
   * @param {Object} fields
   * @returns {Promise<void>}
   */
  async updateItem(itemKey, fields) {
    throw new Error("Not implemented: updateItem");
  }

  /**
   * 写入标签
   * @param {Object} options
   * @param {string} options.action - "set" | "add" | "remove"
   * @param {string} options.itemKey
   * @param {string[]} options.tags
   * @returns {Promise<void>}
   */
  async writeTag(options) {
    throw new Error("Not implemented: writeTag");
  }

  /**
   * 写入元数据
   * @param {string} itemKey
   * @param {Object} fields
   * @returns {Promise<void>}
   */
  async writeMetadata(itemKey, fields) {
    throw new Error("Not implemented: writeMetadata");
  }

  /**
   * 批量写入元数据
   * @param {Array<{itemKey: string, fields: Object}>} updates
   * @returns {Promise<{updated: string[], failed: Array}>}
   */
  async writeMetadataBatch(updates) {
    throw new Error("Not implemented: writeMetadataBatch");
  }
}

/**
 * 验证结果工厂函数
 */
export function createVerifyResult() {
  return {
    success: true,
    present: [],
    missing: [],
  };
}

/**
 * 写入结果工厂函数
 */
export function createWriteResult() {
  return {
    added: [],
    verified: [],
    removed: [],
    failed: [],
  };
}
