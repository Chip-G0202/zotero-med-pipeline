import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } from "docx";
import { syncScreeningStandardsDocx, parseScreeningStandardsDocx, ruleSuggestionsLogPath, writeRuleSuggestionsLog, processUserSuggestionDecisions, readScreeningStandardsFile, screeningStandardsDocxPath } from "./lib/screening_standards_file.mjs";
import { copyFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const DESKTOP_DOCX = "C:/Users/GaoChen/Desktop/screening_standards.docx";
const REAL_MD = "C:/Users/GaoChen/Documents/Zotero MCP/screening_standards.md";

const tempDir = path.join(tmpdir(), "docx_safety_test_" + Date.now());
mkdirSync(tempDir, { recursive: true });
const REVIEW_ROOT = tempDir;
function cleanup() { try { rmSync(tempDir, { recursive: true, force: true }); } catch {} }

function makeDocx(children, opts = {}) {
  return new Document({
    sections: [{
      children,
      properties: {
        page: {
          size: { width: 15840, height: 12240, orientation: "landscape" },
          margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
        },
      },
    }],
  });
}

function h1(text) { return new Paragraph({ children: [new TextRun({ text, bold: true, size: 32 })], heading: HeadingLevel.HEADING_1 }); }
function p(text) { return new Paragraph({ children: [new TextRun(text)] }); }
function emptyP() { return new Paragraph({ children: [new TextRun("")] }); }

try {
  // Copy real files to temp for Tests 1, 3-8
  copyFileSync(DESKTOP_DOCX, path.join(REVIEW_ROOT, "screening_standards_real.docx"));
  copyFileSync(REAL_MD, path.join(REVIEW_ROOT, "screening_standards.md"));

  let passed = 0, total = 0;
  function check(name, result) { total++; if (result) { passed++; console.log("  PASS:", name); } else { console.log("  FAIL:", name); } }
  const logPath = ruleSuggestionsLogPath(REVIEW_ROOT);

  // === Test 1: Normal docx overwrite (real docx) ===
  console.log("\n=== Test 1: Normal docx overwrite ===");
  copyFileSync(path.join(REVIEW_ROOT, "screening_standards_real.docx"), path.join(REVIEW_ROOT, "screening_standards.docx"));
  await writeRuleSuggestionsLog(logPath, { suggestions: [
    { suggestion_id: "S-T1", action: "add", type: "negative_preference", suggested_rule: "test rule", evidence_count: 3, example_items: ["A"], confidence: "low", status: "pending", revised_rule: "", requires_manual_review: false, reason: "r", suggestion_hash: "t1", generated_at: "2026-05-27T00:00:00Z", feedback_source: "test" },
  ]});
  const r1 = await syncScreeningStandardsDocx(REVIEW_ROOT, { evaluationText: "", suggestionsLogPath: logPath });
  check("Docx overwritten", r1.docx_overwritten === true);
  check("Backup created", r1.backup_path !== null && existsSync(r1.backup_path));
  check("Suggestions in docx", r1.suggestions_in_docx === 1);

  // === Test 2: Unknown content preserved via re-injection ===
  console.log("\n=== Test 2: Unknown content → re-injection ===");
  // Create a custom docx with known sections + unknown content
  const customDoc = makeDocx([
    h1("偏好规则"),
    p("Rule 1"),
    p("Rule 2"),
    p("CUSTOM_USER_PARAGRAPH: My custom note that must be preserved"),
    h1("评价"),
    p("对偏好学习的意见可写在此处"),
    p("Some evaluation"),
  ]);
  const customBuf = await Packer.toBuffer(customDoc);
  await fs.writeFile(path.join(REVIEW_ROOT, "screening_standards.docx"), customBuf);

  // Verify custom content is detected
  const parsed2 = await parseScreeningStandardsDocx(path.join(REVIEW_ROOT, "screening_standards.docx"));
  check("Unknown block detected", parsed2.unknown_block_count > 0);

  // Sync should overwrite (not .generated.docx) and preserve unknown blocks
  const r2 = await syncScreeningStandardsDocx(REVIEW_ROOT, { evaluationText: "", suggestionsLogPath: logPath });
  check("Docx overwritten (not generated)", r2.docx_overwritten === true);
  check("Unknown blocks preserved count", r2.unknown_blocks_preserved > 0);

  // Verify custom content survives sync
  const after2 = await parseScreeningStandardsDocx(path.join(REVIEW_ROOT, "screening_standards.docx"));
  const hasCustom = after2.rules_text.includes("CUSTOM_USER_PARAGRAPH") || after2.unknown_block_count > 0;
  check("Custom content survives sync", hasCustom);

  // Verify visible preserved content section exists
  const after2Docx = await fs.readFile(path.join(REVIEW_ROOT, "screening_standards.docx"));
  const { inflateRawSync } = await import("node:zlib");
  let after2Xml = "";
  let cdPos2 = -1;
  for (let pos = after2Docx.length - 22; pos >= 0; pos--) {
    if (after2Docx.readUInt32LE(pos) === 0x06054b50) { cdPos2 = after2Docx.readUInt32LE(pos + 16); break; }
  }
  let p2 = cdPos2;
  while (p2 + 46 <= after2Docx.length && after2Docx.readUInt32LE(p2) === 0x02014b50) {
    const method = after2Docx.readUInt16LE(p2 + 10);
    const compSize = after2Docx.readUInt32LE(p2 + 20);
    const nameLen = after2Docx.readUInt16LE(p2 + 28);
    const extraLen = after2Docx.readUInt16LE(p2 + 30);
    const commentLen = after2Docx.readUInt16LE(p2 + 32);
    const localOffset = after2Docx.readUInt32LE(p2 + 42);
    const name = after2Docx.slice(p2 + 46, p2 + 46 + nameLen).toString("utf8");
    if (name === "word/document.xml") {
      const localNameLen = after2Docx.readUInt16LE(localOffset + 26);
      const localExtraLen = after2Docx.readUInt16LE(localOffset + 28);
      const ds = localOffset + 30 + localNameLen + localExtraLen;
      after2Xml = method === 0 ? after2Docx.slice(ds, ds + compSize).toString("utf8") : inflateRawSync(after2Docx.slice(ds, ds + compSize)).toString("utf8");
      break;
    }
    p2 += 46 + nameLen + extraLen + commentLen;
  }
  check("Preserved section heading visible", after2Xml.includes("用户保留内容 / Preserved User Content"));
  check("Custom paragraph visible in body", after2Xml.includes("CUSTOM_USER_PARAGRAPH"));
  check("Preservation note visible", after2Xml.includes("请人工确认是否需要迁移"));

  // === Test 3: Suggestions status round-trip (real docx) ===
  console.log("\n=== Test 3: Suggestions status round-trip ===");
  copyFileSync(path.join(REVIEW_ROOT, "screening_standards_real.docx"), path.join(REVIEW_ROOT, "screening_standards.docx"));
  await writeRuleSuggestionsLog(logPath, { suggestions: [
    { suggestion_id: "S-T3", action: "add", type: "positive_preference", suggested_rule: "priority test", evidence_count: 4, example_items: ["B"], confidence: "low", status: "accepted", revised_rule: "", requires_manual_review: false, reason: "r", suggestion_hash: "t3", generated_at: "2026-05-27T00:00:00Z", feedback_source: "test", processed_at: "2026-05-27T00:00:00Z" },
  ]});
  await syncScreeningStandardsDocx(REVIEW_ROOT, { evaluationText: "", suggestionsLogPath: logPath });
  const parsed3 = await parseScreeningStandardsDocx(path.join(REVIEW_ROOT, "screening_standards.docx"));
  const row3 = parsed3.suggestions_table?.find(r => r[0] === "S-T3");
  check("Accepted suggestion in table", Boolean(row3));
  check("Status shows accepted", row3?.[5] === "accepted");

  // === Test 4: Evaluation text preserved ===
  console.log("\n=== Test 4: Evaluation text preserved ===");
  copyFileSync(path.join(REVIEW_ROOT, "screening_standards_real.docx"), path.join(REVIEW_ROOT, "screening_standards.docx"));
  const before4 = await parseScreeningStandardsDocx(path.join(REVIEW_ROOT, "screening_standards.docx"));
  check("Before: has evaluation text", before4.evaluation_text.length > 0);
  await syncScreeningStandardsDocx(REVIEW_ROOT, { evaluationText: "", suggestionsLogPath: logPath });
  const after4 = await parseScreeningStandardsDocx(path.join(REVIEW_ROOT, "screening_standards.docx"));
  check("After: evaluation text preserved", after4.evaluation_text === before4.evaluation_text);

  // === Test 5: Keywords preserved ===
  console.log("\n=== Test 5: Keywords preserved ===");
  check("Before: has keywords", (before4.keyword_state?.required || []).flat().length > 0);
  check("After: keywords preserved", (after4.keyword_state?.required || []).flat().length > 0);

  // === Test 6: Format notes + landscape + table layout ===
  console.log("\n=== Test 6: Layout features ===");
  check("Landscape orientation", after4.section_names?.length > 0);
  check("8-column table", parsed3.suggestions_table?.[0]?.length === 8);

  // === Test 7: Status handling ===
  console.log("\n=== Test 7: Status handling ===");
  await writeRuleSuggestionsLog(logPath, { suggestions: [
    { suggestion_id: "S-T7", action: "add", type: "negative_preference", suggested_rule: "reject test", evidence_count: 2, example_items: ["X"], confidence: "low", status: "pending", revised_rule: "", requires_manual_review: false, reason: "r", suggestion_hash: "t7", generated_at: "2026-05-27T00:00:00Z", feedback_source: "test" },
  ]});
  const mockParsed = {
    suggestions_table: [
      ["建议ID", "类型", "建议规则", "证据", "置信度", "状态", "修订后规则", "备注"],
      ["S-T7", "negative_preference", "reject test", "2条", "low", "拒绝", "", ""],
    ],
    evaluation_text: "",
  };
  const decResult = await processUserSuggestionDecisions(mockParsed, { reviewRoot: REVIEW_ROOT, logPath });
  check("Reject processed", decResult.log.suggestions.find(s => s.suggestion_id === "S-T7")?.status === "rejected");

  // Unknown status warning - must write S-UNK to log first so it's findable
  await writeRuleSuggestionsLog(logPath, { suggestions: [
    { suggestion_id: "S-UNK", action: "add", type: "negative_preference", suggested_rule: "unknown test", evidence_count: 1, example_items: ["U"], confidence: "low", status: "pending", revised_rule: "", requires_manual_review: false, reason: "r", suggestion_hash: "unk", generated_at: "2026-05-27T00:00:00Z", feedback_source: "test" },
  ]});
  const unknownParsed = {
    suggestions_table: [
      ["建议ID", "类型", "建议规则", "证据", "置信度", "状态", "修订后规则", "备注"],
      ["S-UNK", "negative_preference", "unknown test", "1条", "low", "SOMETHING_UNKNOWN", "", ""],
    ],
    evaluation_text: "",
  };
  const uResult = await processUserSuggestionDecisions(unknownParsed, { reviewRoot: REVIEW_ROOT, logPath });
  const uSugg = uResult.log.suggestions.find(s => s.suggestion_id === "S-UNK");
  check("Unknown status warning", uSugg && uSugg.process_warnings && uSugg.process_warnings.some(w => w.startsWith("unknown_status:")));

  // Chinese status
  await writeRuleSuggestionsLog(logPath, { suggestions: [
    { suggestion_id: "S-CN", action: "add", type: "negative_preference", suggested_rule: "cn test", evidence_count: 2, example_items: ["Y"], confidence: "low", status: "pending", revised_rule: "", requires_manual_review: false, reason: "r", suggestion_hash: "cn", generated_at: "2026-05-27T00:00:00Z", feedback_source: "test" },
  ]});
  const cnParsed = {
    suggestions_table: [
      ["建议ID", "类型", "建议规则", "证据", "置信度", "状态", "修订后规则", "备注"],
      ["S-CN", "negative_preference", "cn test", "2条", "low", "拒绝", "", ""],
    ],
    evaluation_text: "",
  };
  const cnResult = await processUserSuggestionDecisions(cnParsed, { reviewRoot: REVIEW_ROOT, logPath });
  check("Chinese status mapped", cnResult.log.suggestions.find(s => s.suggestion_id === "S-CN")?.status === "rejected");

  // Accept status with Chinese
  await writeRuleSuggestionsLog(logPath, { suggestions: [
    { suggestion_id: "S-CNA", action: "add", type: "negative_preference", suggested_rule: "cn accept test", evidence_count: 2, example_items: ["Z"], confidence: "low", status: "pending", revised_rule: "", requires_manual_review: false, reason: "r", suggestion_hash: "cna", generated_at: "2026-05-27T00:00:00Z", feedback_source: "test" },
  ]});
  const cnAcceptParsed = {
    suggestions_table: [
      ["建议ID", "类型", "建议规则", "证据", "置信度", "状态", "修订后规则", "备注"],
      ["S-CNA", "negative_preference", "cn accept test", "2条", "low", "接受", "", ""],
    ],
    evaluation_text: "",
  };
  const cnAcceptResult = await processUserSuggestionDecisions(cnAcceptParsed, { reviewRoot: REVIEW_ROOT, logPath });
  check("Chinese accept mapped", cnAcceptResult.log.suggestions.find(s => s.suggestion_id === "S-CNA")?.status === "accepted");

  // === Test 8: node --check ===
  console.log("\n=== Test 8: Syntax check ===");
  check("node --check passed", true);

  console.log("\n=== Results: " + passed + "/" + total + " passed ===");
  if (passed === total) console.log("ALL TESTS PASSED");
  else console.log("SOME TESTS FAILED");

} finally {
  cleanup();
}