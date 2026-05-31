import fs from "node:fs/promises";
import path from "node:path";

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function paragraphXml(text, style) {
  const props = style ? `<w:pPr><w:pStyle w:val="${escapeXml(style)}"/></w:pPr>` : "";
  return `<w:p>${props}<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function tableXml(rows) {
  const totalWidth = Math.max(1, rows.reduce((max, row) => Math.max(max, row.length), 0)) * 2400;
  const gridCols = Array.from({ length: Math.max(1, rows.reduce((max, row) => Math.max(max, row.length), 0)) })
    .map((_, idx) => `<w:gridCol w:w="${2400}" />`)
    .join("");
  const buildRow = (cells, isHeader) => {
    const cellsXml = cells.map((value) => {
      const cellProps = isHeader ? `<w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="D9E2F3"/></w:tcPr>` : "";
      const runProps = isHeader ? `<w:rPr><w:b/></w:rPr>` : "";
      return `<w:tc>${cellProps}<w:p><w:r>${runProps}<w:t xml:space="preserve">${escapeXml(value)}</w:t></w:r></w:p></w:tc>`;
    }).join("");
    return `<w:tr>${cellsXml}</w:tr>`;
  };
  const bodyRows = rows.map((row, idx) => buildRow(row, idx === 0)).join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="${totalWidth}" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr><w:tblGrid>${gridCols}</w:tblGrid>${bodyRows}</w:tbl>`;
}

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    c ^= buffer[i];
    for (let j = 0; j < 8; j++) {
      c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function encodeBytes(value) {
  return Buffer.from(value, "utf-8");
}

function localFileHeader(nameBytes, crc, size) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(size, 18);
  header.writeUInt32LE(size, 22);
  header.writeUInt16LE(nameBytes.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, nameBytes]);
}

function centralDirectoryHeader(nameBytes, crc, size, offset) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(0, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(size, 20);
  header.writeUInt32LE(size, 24);
  header.writeUInt16LE(nameBytes.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(offset, 42);
  return Buffer.concat([header, nameBytes]);
}

function endOfCentralDirectory(totalEntries, directorySize, directoryOffset) {
  const buffer = Buffer.alloc(22);
  buffer.writeUInt32LE(0x06054b50, 0);
  buffer.writeUInt16LE(0, 4);
  buffer.writeUInt16LE(0, 6);
  buffer.writeUInt16LE(totalEntries, 8);
  buffer.writeUInt16LE(totalEntries, 10);
  buffer.writeUInt32LE(directorySize, 12);
  buffer.writeUInt32LE(directoryOffset, 16);
  buffer.writeUInt16LE(0, 20);
  return buffer;
}

function buildZip(parts) {
  const localParts = [];
  const directoryParts = [];
  let offset = 0;

  for (const { name, content } of parts) {
    const nameBytes = encodeBytes(name);
    const contentBytes = encodeBytes(content);
    const crc = crc32(contentBytes);
    const local = localFileHeader(nameBytes, crc, contentBytes.length);
    localParts.push(local, contentBytes);
    directoryParts.push(centralDirectoryHeader(nameBytes, crc, contentBytes.length, offset));
    offset += local.length + contentBytes.length;
  }

  const directoryBuffer = Buffer.concat(directoryParts);
  const end = endOfCentralDirectory(parts.length, directoryBuffer.length, offset);
  return Buffer.concat([...localParts, directoryBuffer, end]);
}

export function buildDocxBuffer(bodyXml, { stylesXml } = {}) {
  const styles = stylesXml || `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="22"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
</w:styles>`;
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${bodyXml}
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr>
  </w:body>
</w:document>`;

  return buildZip([
    { name: "[Content_Types].xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>` },
    { name: "_rels/.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: "word/_rels/document.xml.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "word/document.xml", content: documentXml },
    { name: "word/styles.xml", content: styles },
  ]);
}

export function paragraph(text, style) {
  return paragraphXml(text, style);
}

export function table(rows) {
  return tableXml(rows);
}

export async function writeDocxFile(outputPath, bodyXml, options) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, buildDocxBuffer(bodyXml, options));
  return outputPath;
}
