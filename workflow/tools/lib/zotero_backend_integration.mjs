/**
 * Zotero Backend Integration
 *
 * 主入口集成模块，提供统一的初始化和生命周期管理。
 *
 * 使用方法：
 *   import { initZoteroBackend, getAdapter, shutdownZoteroBackend } from "./lib/zotero_backend_integration.mjs";
 *   await initZoteroBackend();
 *   const adapter = getAdapter();
 *   // ... 使用 adapter
 *   await shutdownZoteroBackend();
 */

import { ZoteroAdapter, getZoteroAdapter, resetZoteroAdapter } from "./zotero_adapter.mjs";
import { ensureZoteroBackendReady, getRecommendedBackend } from "./ensure_zotero_backend_ready.mjs";
import { createCompatMcpToolCall, createVerifiedMcpToolCall } from "./zotero_backend_compat.mjs";

let _initialized = false;
let _initResult = null;

/**
 * 初始化 Zotero 后端
 *
 * @param {Object} options
 * @param {string} options.preferredBackend - "web_api" | "cli" | "auto"
 * @param {boolean} options.verifyAfterWrite - collection 写入后是否 verify
 * @param {Function} options.log - 日志函数
 * @returns {Promise<Object>} 初始化结果
 */
export async function initZoteroBackend(options = {}) {
  const {
    preferredBackend = process.env.ZOTERO_BACKEND || "auto",
    log = console.log,
  } = options;

  if (_initialized) {
    log("[Integration] Already initialized");
    return _initResult;
  }

  const recommended = getRecommendedBackend();
  log(`[Integration] Recommended backend: ${recommended.backend} (${recommended.reason})`);

  try {
    _initResult = await ensureZoteroBackendReady({
      preferredBackend,
      log,
    });
    _initialized = true;
    log(`[Integration] Backend ready: ${_initResult.backend}`);
    return _initResult;
  } catch (error) {
    log(`[Integration] Backend initialization failed: ${error.message}`);
    throw error;
  }
}

/**
 * 获取适配器实例
 *
 * @returns {ZoteroAdapter}
 */
export function getAdapter() {
  if (!_initialized) {
    throw new Error("Backend not initialized. Call initZoteroBackend() first.");
  }
  return getZoteroAdapter();
}

/**
 * 获取兼容的 mcpToolCall 函数
 *
 * @param {Object} options
 * @param {boolean} options.verified - 是否使用带 verify 的版本
 * @returns {Promise<Function>}
 */
export async function getCompatMcpToolCall(options = {}) {
  if (!_initialized) {
    throw new Error("Backend not initialized. Call initZoteroBackend() first.");
  }

  if (options.verified) {
    return createVerifiedMcpToolCall();
  }
  return createCompatMcpToolCall();
}

/**
 * 关闭后端（重置状态）
 */
export function shutdownZoteroBackend() {
  resetZoteroAdapter();
  _initialized = false;
  _initResult = null;
}

/**
 * 检查是否已初始化
 */
export function isInitialized() {
  return _initialized;
}

export default {
  initZoteroBackend,
  getAdapter,
  getCompatMcpToolCall,
  shutdownZoteroBackend,
  isInitialized,
};
