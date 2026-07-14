import zlib from "node:zlib";

export function escapeXml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function makeCrc32Table() {
  const table = [];
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
}

const CRC32_TABLE = makeCrc32Table();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const b of buffer) c = CRC32_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

function zipStore(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  const { dosTime, dosDate } = dosDateTime();
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.from(entry.content, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, data);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(0, 10);
    dir.writeUInt16LE(dosTime, 12);
    dir.writeUInt16LE(dosDate, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt16LE(0, 30);
    dir.writeUInt16LE(0, 32);
    dir.writeUInt16LE(0, 34);
    dir.writeUInt16LE(0, 36);
    dir.writeUInt32LE(0, 38);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += local.length + name.length + data.length;
  }
  const centralStart = offset;
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, centralBuf, end]);
}

export function lineDiff(previousText, currentText) {
  const previous = String(previousText || "").replace(/\r\n/g, "\n").split("\n");
  const current = String(currentText || "").replace(/\r\n/g, "\n").split("\n");
  if (previous.at(-1) === "") previous.pop();
  if (current.at(-1) === "") current.pop();
  const dp = Array.from({ length: previous.length + 1 }, () => Array(current.length + 1).fill(0));
  for (let i = previous.length - 1; i >= 0; i -= 1) {
    for (let j = current.length - 1; j >= 0; j -= 1) {
      dp[i][j] = previous[i] === current[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < previous.length || j < current.length) {
    if (i < previous.length && j < current.length && previous[i] === current[j]) {
      out.push({ type: "same", text: current[j] });
      i += 1;
      j += 1;
    } else if (j < current.length && (i >= previous.length || dp[i][j + 1] >= dp[i + 1][j])) {
      out.push({ type: "add", text: current[j] });
      j += 1;
    } else {
      out.push({ type: "delete", text: previous[i] });
      i += 1;
    }
  }
  return out;
}

function paragraphXml(part) {
  const style = part.style === "Heading1" || String(part.text || "").startsWith("#") ? '<w:pStyle w:val="Heading1"/>' : "";
  const text = String(part.text || "").replace(/^#+\s*/, "");
  const color = part.type === "add" ? '<w:color w:val="FF0000"/>' : part.type === "delete" ? '<w:color w:val="0000FF"/><w:strike/>' : "";
  const runProps = color ? `<w:rPr>${color}</w:rPr>` : "";
  return `<w:p><w:pPr>${style}</w:pPr><w:r>${runProps}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function tableXml(rows = []) {
  const rowXml = rows.map((row) => `<w:tr>${row.map((cell) => `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t xml:space="preserve">${escapeXml(cell)}</w:t></w:r></w:p></w:tc>`).join("")}</w:tr>`).join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="2200"/><w:gridCol w:w="3800"/><w:gridCol w:w="3000"/></w:tblGrid>${rowXml}</w:tbl>`;
}

function suggestionsTableXml(suggestions = []) {
  const headers = ["建议ID", "类型", "建议规则", "证据", "置信度", "状态", "修订后规则", "备注"];
  const colWidths = [1300, 1000, 3500, 1800, 700, 900, 3000, 1200];
  const gridCols = colWidths.map((width) => `<w:gridCol w:w="${width}"/>`).join("");
  const totalWidth = colWidths.reduce((a, b) => a + b, 0);
  const wrapCell = (text, width, bold = false) => {
    const rPr = bold ? "<w:rPr><w:b/></w:rPr>" : "";
    return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:textWrapping w:wrap="tight"/></w:tcPr><w:p><w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p></w:tc>`;
  };
  const headerRow = `<w:tr>${headers.map((header, i) => wrapCell(header, colWidths[i], true)).join("")}</w:tr>`;
  const dataRows = suggestions.map((suggestion) => {
    const evidenceCount = suggestion.evidence_count ? `(${suggestion.evidence_count}条)` : "";
    const cells = [suggestion.suggestion_id || "", suggestion.type || "", suggestion.suggested_rule || "", evidenceCount, suggestion.confidence || "", suggestion.status || "pending", suggestion.revised_rule || "", suggestion.reason || ""];
    return `<w:tr>${cells.map((cell, i) => wrapCell(cell, colWidths[i])).join("")}</w:tr>`;
  }).join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="${totalWidth}" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr><w:tblGrid>${gridCols}</w:tblGrid>${headerRow}${dataRows}</w:tbl>`;
}

export function buildDocxBuffer(parts, { unknownBlocks = [] } = {}) {
  const managedContent = parts.map((part) => part.kind === "suggestions_table" ? suggestionsTableXml(part.rows) : part.kind === "table" ? tableXml(part.rows) : paragraphXml(part)).join("");
  let preservedContent = "";
  if (unknownBlocks.length) {
    const preservedHeading = paragraphXml({ text: "用户保留内容 / Preserved User Content", style: "Heading1" });
    const preservedNote = paragraphXml({ text: "以下内容来自上一次 docx 中系统未识别的区域，已保留；请人工确认是否需要迁移到人工评价区或待确认规则建议表格。" });
    const preservedBlocks = unknownBlocks.map((block) => {
      const textMatch = block.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g);
      if (textMatch) {
        const text = textMatch.map((match) => match.replace(/<[^>]+>/g, "")).join("");
        return paragraphXml({ text });
      }
      return "";
    }).filter(Boolean);
    preservedContent = preservedHeading + preservedNote + preservedBlocks.join("");
  }
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${managedContent}${preservedContent}<w:sectPr><w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr></w:body></w:document>`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="22"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style></w:styles>`;
  return zipStore([
    { name: "[Content_Types].xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>` },
    { name: "_rels/.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: "word/_rels/document.xml.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "word/document.xml", content: documentXml },
    { name: "word/styles.xml", content: stylesXml },
  ]);
}

function unescapeXml(text) {
  return String(text || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

export function textFromXml(xml) {
  return Array.from(String(xml || "").matchAll(/<(?:[^:<>\s]+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:[^:<>\s]+:)?t>/g))
    .map((match) => unescapeXml(match[1]))
    .join("");
}

export function tableRowsFromXml(xml) {
  return Array.from(String(xml || "").matchAll(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g)).map((rowMatch) => {
    return Array.from(rowMatch[0].matchAll(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g)).map((cellMatch) => textFromXml(cellMatch[0]).trim());
  });
}

export function parseZipEntries(buffer) {
  const entries = new Map();
  let centralDir = -1;
  for (let pos = buffer.length - 22; pos >= 0 && pos >= buffer.length - 0xffff - 22; pos -= 1) {
    if (buffer.readUInt32LE(pos) === 0x06054b50) {
      centralDir = buffer.readUInt32LE(pos + 16);
      break;
    }
  }
  if (centralDir >= 0) {
    let pos = centralDir;
    while (pos + 46 <= buffer.length && buffer.readUInt32LE(pos) === 0x02014b50) {
      const method = buffer.readUInt16LE(pos + 10);
      const compSize = buffer.readUInt32LE(pos + 20);
      const nameLen = buffer.readUInt16LE(pos + 28);
      const extraLen = buffer.readUInt16LE(pos + 30);
      const commentLen = buffer.readUInt16LE(pos + 32);
      const localOffset = buffer.readUInt32LE(pos + 42);
      const name = buffer.slice(pos + 46, pos + 46 + nameLen).toString("utf8");
      if (localOffset + 30 <= buffer.length && buffer.readUInt32LE(localOffset) === 0x04034b50) {
        const localNameLen = buffer.readUInt16LE(localOffset + 26);
        const localExtraLen = buffer.readUInt16LE(localOffset + 28);
        const dataStart = localOffset + 30 + localNameLen + localExtraLen;
        const comp = buffer.slice(dataStart, dataStart + compSize);
        if (method === 0) entries.set(name, comp.toString("utf8"));
        if (method === 8) entries.set(name, zlib.inflateRawSync(comp).toString("utf8"));
      }
      pos += 46 + nameLen + extraLen + commentLen;
    }
    if (entries.size) return entries;
  }

  let pos = 0;
  while (pos + 30 <= buffer.length) {
    if (buffer.readUInt32LE(pos) !== 0x04034b50) break;
    const method = buffer.readUInt16LE(pos + 8);
    const compSize = buffer.readUInt32LE(pos + 18);
    const nameLen = buffer.readUInt16LE(pos + 26);
    const extraLen = buffer.readUInt16LE(pos + 28);
    const name = buffer.slice(pos + 30, pos + 30 + nameLen).toString("utf8");
    const dataStart = pos + 30 + nameLen + extraLen;
    const dataEnd = dataStart + compSize;
    const comp = buffer.slice(dataStart, dataEnd);
    if (method === 0) entries.set(name, comp.toString("utf8"));
    if (method === 8) entries.set(name, zlib.inflateRawSync(comp).toString("utf8"));
    pos = dataEnd;
  }
  return entries;
}
