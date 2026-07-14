#!/usr/bin/env node

/**
 * Zotero CLI Capability Probe
 *
 * 阶段 0：CLI 能力探针与命令矩阵确认
 *
 * 目标：验证两个 CLI 工具的可用能力、参数顺序、JSON 输出结构、错误码和 collection 行为
 *
 * 使用方法：
 *   node workflow/tools/diagnostics/zotero_cli_probe.mjs [--tool=zotero-cli-cc|cli-anything-zotero|web|desktop|all] [--test-collection=测试集合名]
 *
 * 注意：
 * - 仅用于阶段 0 探测，不做真实大批量写入
 * - 测试集合会在测试结束后提示是否删除
 * - 如果真实写入不可避免，使用 --apply 确认参数
 */

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { executeCli, getDefaultCliTool } from "../lib/zotero_cli_executor.mjs";

const PROBE_VERSION = "0.1.0";
const HELP = `Usage: node workflow/tools/diagnostics/zotero_cli_probe.mjs [options]

Options:
  --tool <name>              all | cli-anything-zotero | zotero-cli-cc | desktop | web
  --tool=<name>              Same as --tool <name>
  --test-collection <name>   Collection name used only with --apply
  --test-collection=<name>   Same as --test-collection <name>
  --apply                    Allow probe write operations
  --no-report                Do not write docs/zotero-cli-probe-results.json
  --help, -h                 Show this help

Default mode is read-only. Write probes are reported as skipped unless --apply is explicit.`;

// 解析命令行参数
const args = process.argv.slice(2);
function readArgValue(name) {
  const eq = args.find((x) => x.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const idx = args.indexOf(name);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return "";
}

const SHOW_HELP = args.includes("--help") || args.includes("-h");
const TARGET_TOOL = readArgValue("--tool") || "all";
const TEST_COLLECTION = readArgValue("--test-collection") || `CLI_Probe_Test_${Date.now()}`;
const ALLOW_WRITE = args.includes("--apply");
const WRITE_REPORT = !args.includes("--no-report");
const VALID_TOOLS = new Set(["all", "cli-anything-zotero", "zotero-cli-cc", "desktop", "web"]);

// 测试结果收集
const results = {
  version: PROBE_VERSION,
  timestamp: new Date().toISOString(),
  targetTool: TARGET_TOOL,
  allowWrite: ALLOW_WRITE,
  tests: []
};

/**
 * 执行 CLI 命令并捕获输出
 */
async function executeCommand(command, commandArgs, options = {}) {
  try {
    const result = await executeCli(command, commandArgs, {
      json: false,
      timeoutMs: options.timeoutMs || 10000,
      stdin: options.stdin ?? null,
    });
    return {
      command: `${command} ${commandArgs.join(" ")}`,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      success: result.exitCode === 0,
    };
  } catch (error) {
    return {
      command: `${command} ${commandArgs.join(" ")}`,
      error: error.message,
      stderr: error.message,
      success: false,
    };
  }
}

/**
 * 记录测试结果
 */
function recordTest(name, category, result, notes = "") {
  results.tests.push({
    name,
    category,
    ...result,
    notes,
    timestamp: new Date().toISOString()
  });

  const skipped = result.skipped === true;
  const status = skipped ? "⏭" : result.success ? "✅" : "❌";
  console.log(`${status} ${category}/${name}: ${skipped ? "SKIP" : result.success ? "PASS" : "FAIL"}`);
  if (!result.success && result.stderr) {
    console.log(`   Error: ${result.stderr.substring(0, 100)}...`);
  }
}

/**
 * 测试 zotero-cli-cc
 */
async function testZoteroCliCc() {
  console.log("\n=== Testing zotero-cli-cc ===\n");

  const cli = getDefaultCliTool("web");

  // 1. Ping/Health Check
  try {
    const result = await executeCommand(cli, ["app", "ping"]);
    recordTest("ping", "health", result);
  } catch (error) {
    recordTest("ping", "health", { success: false, stderr: error.error });
  }

  // 2. Search
  try {
    const result = await executeCommand(cli, ["search", "test", "--json", "--limit", "1"]);
    recordTest("search", "read", result);

    // 验证 JSON 输出格式
    if (result.success) {
      try {
        const json = JSON.parse(result.stdout);
        recordTest("search_json_format", "read", {
          success: true,
          stdout: JSON.stringify(Object.keys(json))
        });
      } catch (e) {
        recordTest("search_json_format", "read", {
          success: false,
          stderr: "Invalid JSON output"
        });
      }
    }
  } catch (error) {
    recordTest("search", "read", { success: false, stderr: error.error });
  }

  // 3. Read Item
  try {
    // 先搜索获取一个 item key
    const searchResult = await executeCommand(cli, ["search", "test", "--json", "--limit", "1"]);
    if (searchResult.success) {
      const searchData = JSON.parse(searchResult.stdout);
      const itemKey = searchData.data?.[0]?.key;

      if (itemKey) {
        const result = await executeCommand(cli, ["read", itemKey, "--json"]);
        recordTest("read_item", "read", result);
      } else {
        recordTest("read_item", "read", { success: false, stderr: "No items found" });
      }
    }
  } catch (error) {
    recordTest("read_item", "read", { success: false, stderr: error.error });
  }

  // 4. Collections
  try {
    const result = await executeCommand(cli, ["collections", "--json"]);
    recordTest("list_collections", "collection", result);
  } catch (error) {
    recordTest("list_collections", "collection", { success: false, stderr: error.error });
  }

  // 5. Collection Create (需要 --apply)
  if (ALLOW_WRITE) {
    try {
      const result = await executeCommand(cli, ["collections", "create", TEST_COLLECTION]);
      recordTest("create_collection", "collection_write", result);
    } catch (error) {
      recordTest("create_collection", "collection_write", { success: false, stderr: error.error });
    }
  } else {
    recordTest("create_collection", "collection_write", {
      success: true,
      skipped: true,
      stderr: "Skipped: requires --apply flag"
    }, "Dry run - not executed");
  }

  // 6. Collection Items
  try {
    // 获取第一个集合的 key
    const collectionsResult = await executeCommand(cli, ["collections", "--json"]);
    if (collectionsResult.success) {
      const collections = JSON.parse(collectionsResult.stdout);
      const collectionKey = collections.data?.[0]?.key;

      if (collectionKey) {
        const result = await executeCommand(cli, ["collections", "items", collectionKey, "--json"]);
        recordTest("collection_items", "collection", result);
      }
    }
  } catch (error) {
    recordTest("collection_items", "collection", { success: false, stderr: error.error });
  }

  // 7. Tag Operations (读取)
  try {
    const searchResult = await executeCommand(cli, ["search", "test", "--json", "--limit", "1"]);
    if (searchResult.success) {
      const searchData = JSON.parse(searchResult.stdout);
      const itemKey = searchData.data?.[0]?.key;

      if (itemKey) {
        const result = await executeCommand(cli, ["tags", "list", "--json"]);
        recordTest("list_tags", "tag", result);
      }
    }
  } catch (error) {
    recordTest("list_tags", "tag", { success: false, stderr: error.error });
  }

  // 8. Metadata Update (需要 --apply)
  if (ALLOW_WRITE) {
    try {
      const searchResult = await executeCommand(cli, ["search", "test", "--json", "--limit", "1"]);
      if (searchResult.success) {
        const searchData = JSON.parse(searchResult.stdout);
        const itemKey = searchData.data?.[0]?.key;

        if (itemKey) {
          // 注意：这会修改真实数据！
          const currentTitle = searchData.data?.[0]?.title || searchData.data?.[0]?.data?.title || "Test";
          const result = await executeCommand(cli, [
            "update", itemKey,
            "--field", `title=${currentTitle}`
          ]);
          recordTest("update_metadata", "metadata_write", result);
        }
      }
    } catch (error) {
      recordTest("update_metadata", "metadata_write", { success: false, stderr: error.error });
    }
  } else {
    recordTest("update_metadata", "metadata_write", {
      success: true,
      skipped: true,
      stderr: "Skipped: requires --apply flag"
    }, "Dry run - not executed");
  }
}

/**
 * 测试 cli-anything-zotero
 */
async function testCliAnythingZotero() {
  console.log("\n=== Testing cli-anything-zotero ===\n");

  const cli = getDefaultCliTool("desktop");

  // 1. Ping/Health Check
  try {
    const result = await executeCommand(cli, ["app", "ping"]);
    recordTest("ping", "health", result);
  } catch (error) {
    recordTest("ping", "health", { success: false, stderr: error.error });
  }

  // 2. Search
  try {
    const result = await executeCommand(cli, ["item", "find", "test", "--json"]);
    recordTest("search", "read", result);

    // 验证 JSON 输出格式
    if (result.success) {
      try {
        const json = JSON.parse(result.stdout);
        recordTest("search_json_format", "read", {
          success: true,
          stdout: JSON.stringify(Array.isArray(json) ? json[0] ? Object.keys(json[0]) : [] : Object.keys(json))
        });
      } catch (e) {
        recordTest("search_json_format", "read", {
          success: false,
          stderr: "Invalid JSON output"
        });
      }
    }
  } catch (error) {
    recordTest("search", "read", { success: false, stderr: error.error });
  }

  // 3. Read Item
  try {
    const searchResult = await executeCommand(cli, ["item", "find", "test", "--json"]);
    if (searchResult.success) {
      const searchData = JSON.parse(searchResult.stdout);
      const itemKey = searchData[0]?.key || searchData.data?.[0]?.key;

      if (itemKey) {
        const result = await executeCommand(cli, ["item", "get", itemKey, "--json"]);
        recordTest("read_item", "read", result);
      }
    }
  } catch (error) {
    recordTest("read_item", "read", { success: false, stderr: error.error });
  }

  // 4. Collections
  try {
    const result = await executeCommand(cli, ["collection", "tree"]);
    recordTest("list_collections", "collection", result);
  } catch (error) {
    recordTest("list_collections", "collection", { success: false, stderr: error.error });
  }

  // 5. Collection Create (需要 --apply)
  if (ALLOW_WRITE) {
    try {
      const result = await executeCommand(cli, ["collection", "create", TEST_COLLECTION]);
      recordTest("create_collection", "collection_write", result);
    } catch (error) {
      recordTest("create_collection", "collection_write", { success: false, stderr: error.error });
    }
  } else {
    recordTest("create_collection", "collection_write", {
      success: true,
      skipped: true,
      stderr: "Skipped: requires --apply flag"
    }, "Dry run - not executed");
  }

  // 6. Collection Items
  try {
    const treeResult = await executeCommand(cli, ["collection", "tree"]);
    if (treeResult.success) {
      // 从 tree 输出中提取 collection key
      const match = treeResult.stdout.match(/([A-Z0-9]{8})/);
      if (match) {
        const result = await executeCommand(cli, ["collection", "items", match[1]]);
        recordTest("collection_items", "collection", result);
      }
    }
  } catch (error) {
    recordTest("collection_items", "collection", { success: false, stderr: error.error });
  }

  // 7. Tag Operations
  try {
    const result = await executeCommand(cli, ["tag", "list"]);
    recordTest("list_tags", "tag", result);
  } catch (error) {
    recordTest("list_tags", "tag", { success: false, stderr: error.error });
  }

  // 8. Metadata Update (需要 --apply)
  if (ALLOW_WRITE) {
    try {
      const searchResult = await executeCommand(cli, ["item", "find", "test", "--json"]);
      if (searchResult.success) {
        const searchData = JSON.parse(searchResult.stdout);
        const itemKey = searchData[0]?.key || searchData.data?.[0]?.key;

        if (itemKey) {
          const result = await executeCommand(cli, [
            "item", "update", itemKey,
            "--field", "title=Test Title"
          ]);
          recordTest("update_metadata", "metadata_write", result);
        }
      }
    } catch (error) {
      recordTest("update_metadata", "metadata_write", { success: false, stderr: error.error });
    }
  } else {
    recordTest("update_metadata", "metadata_write", {
      success: true,
      skipped: true,
      stderr: "Skipped: requires --apply flag"
    }, "Dry run - not executed");
  }
}

/**
 * 清理测试数据
 */
async function cleanupTestData() {
  if (!ALLOW_WRITE) return;

  console.log("\n=== Cleanup ===\n");
  console.log(`Test collection "${TEST_COLLECTION}" was created.`);
  console.log("You may want to delete it manually in Zotero.");
}

/**
 * 生成报告
 */
async function generateReport() {
  if (WRITE_REPORT) {
    const reportPath = path.join("docs", "zotero-cli-probe-results.json");
    await fs.writeFile(reportPath, JSON.stringify(results, null, 2));
    console.log(`\n📊 Report saved to: ${reportPath}`);
  }

  // 生成摘要
  const summary = {
    totalTests: results.tests.length,
    passed: results.tests.filter(t => t.success && !t.skipped).length,
    skipped: results.tests.filter(t => t.skipped).length,
    failed: results.tests.filter(t => !t.success).length,
    byCategory: {}
  };

  for (const test of results.tests) {
    if (!summary.byCategory[test.category]) {
      summary.byCategory[test.category] = { passed: 0, failed: 0 };
    }
    if (test.skipped) {
      summary.byCategory[test.category].skipped = (summary.byCategory[test.category].skipped || 0) + 1;
    } else if (test.success) {
      summary.byCategory[test.category].passed++;
    } else {
      summary.byCategory[test.category].failed++;
    }
  }

  console.log("\n📈 Summary:");
  console.log(`   Total: ${summary.totalTests}`);
  console.log(`   Passed: ${summary.passed}`);
  console.log(`   Skipped: ${summary.skipped}`);
  console.log(`   Failed: ${summary.failed}`);
  console.log("\n   By Category:");
  for (const [category, stats] of Object.entries(summary.byCategory)) {
    console.log(`     ${category}: ${stats.passed} passed, ${stats.skipped || 0} skipped, ${stats.failed} failed`);
  }
}

/**
 * 主函数
 */
async function main() {
  if (SHOW_HELP) {
    console.log(HELP);
    return;
  }
  if (!VALID_TOOLS.has(TARGET_TOOL)) {
    console.error(`Unsupported --tool value: ${TARGET_TOOL}`);
    console.error("Supported values: all, cli-anything-zotero, zotero-cli-cc, desktop, web");
    process.exitCode = 2;
    return;
  }
  console.log(`\n🔍 Zotero CLI Capability Probe v${PROBE_VERSION}`);
  console.log(`Target: ${TARGET_TOOL}`);
  console.log(`Allow Write: ${ALLOW_WRITE}`);
  console.log(`Test Collection: ${TEST_COLLECTION}`);

  try {
    if (TARGET_TOOL === "all" || TARGET_TOOL === "zotero-cli-cc" || TARGET_TOOL === "web") {
      await testZoteroCliCc();
    }

    if (TARGET_TOOL === "all" || TARGET_TOOL === "cli-anything-zotero" || TARGET_TOOL === "desktop") {
      await testCliAnythingZotero();
    }

    await cleanupTestData();
    await generateReport();

  } catch (error) {
    console.error("\n❌ Probe failed:", error.message);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main();
}
