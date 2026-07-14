import fs from "node:fs/promises";
import path from "node:path";

const [sourcePath, outputPath, runId = `desktop-${Date.now()}`, countRaw = "20"] = process.argv.slice(2);
if (!sourcePath || !outputPath) throw new Error("usage: node tests/helpers/desktop_writeback_fixture.mjs <source> <output> <run-id> <count>");
const source = JSON.parse(await fs.readFile(sourcePath, "utf8"));
const count = Math.max(1, Number(countRaw) || 20);
const items = source.slice(0, count).map((item, index) => ({
  ...item,
  title: `Paperflow Desktop recovery fixture ${runId} ${index + 1}`,
  doi: "",
  DOI: "",
  pmid: "",
  pmcid: "",
  arxiv: "",
  arxiv_id: "",
  url: "",
  URL: "",
  dedupe_key: "",
}));
await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(items, null, 2)}\n`, "utf8");
