import mammoth from "mammoth";
import * as XLSX from "xlsx";
import JSZip from "jszip";

const escapeHtml = (value = "") => String(value)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

const hasArabicScript = (text = "") => /[\u0600-\u06FF]/.test(String(text));

/* ---------------------------------- DOCX ---------------------------------- */

export async function docxToHtml(buffer) {
  const options = {
    styleMap: [
      "p[style-name='Title'] => h1.doc-title:fresh",
      "p[style-name='Heading 1'] => h1:fresh",
      "p[style-name='Heading 2'] => h2:fresh",
      "p[style-name='Heading 3'] => h3:fresh",
    ],
    convertImage: mammoth.images.imgElement(async (image) => {
      const base64 = await image.read("base64");
      return { src: `data:${image.contentType};base64,${base64}` };
    }),
  };
  const result = await mammoth.convertToHtml({ buffer }, options);
  const plain = await mammoth.extractRawText({ buffer });
  const rtl = hasArabicScript(plain.value);
  return {
    html: result.value,
    rtl,
    text: plain.value,
    warnings: result.messages.map((m) => m.message),
  };
}

/* ---------------------------------- XLSX ---------------------------------- */

function columnLetter(index) {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export function readWorkbook(buffer) {
  return XLSX.read(buffer, { type: "buffer", cellStyles: false, cellDates: true });
}

export function workbookToHtml(buffer) {
  const workbook = readWorkbook(buffer);
  const parts = [];
  let documentRtl = false;
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    const ref = sheet["!ref"] || "A1";
    const range = XLSX.utils.decode_range(ref);
    const merges = sheet["!merges"] || [];
    const colWidths = sheet["!cols"] || [];
    let rtl = false;
    const rows = [];
    for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 2000); r += 1) {
      const cells = [];
      for (let c = range.s.c; c <= Math.min(range.e.c, range.s.c + 60); c += 1) {
        const address = `${columnLetter(c)}${r + 1}`;
        const cell = sheet[address];
        if (!cell) {
          cells.push("");
          continue;
        }
        let value = cell.w !== undefined ? cell.w : cell.v !== undefined ? cell.v : "";
        if (hasArabicScript(value)) { rtl = true; documentRtl = true; }
        if (cell.f && cell.f[0] === "=") value = String(value);
        cells.push(escapeHtml(value));
      }
      rows.push(cells);
    }
    const head = rows.length > 1 ? rows[0] : [];
    const body = rows.length > 1 ? rows.slice(1) : rows;
    const label = escapeHtml(name);
    parts.push(`
      <section class="sheet">
        ${workbook.SheetNames.length > 1 ? `<h2 class="sheet-name">${label}</h2>` : ""}
        <table>
          ${head.length ? `<thead><tr>${head.map((cell) => `<th>${cell}</th>`).join("")}</tr></thead>` : ""}
          <tbody>${body.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody>
        </table>
      </section>`);
  }
  return { html: parts.join(""), rtl: documentRtl };
}

export const spreadsheetCss = `
  .sheet { page-break-after: always; }
  .sheet:last-child { page-break-after: auto; }
  .sheet-name { font-size: 12pt; margin: 0 0 6pt; color: #333; }
  table { font-size: 9pt; table-layout: auto; }
  thead th { background: #eef0f7; border: 1px solid #c8cddd; padding: 4pt 6pt; text-align: start; font-weight: 700; }
  tbody td { border: 1px solid #d8dce8; padding: 3.5pt 6pt; vertical-align: top; }
  tbody tr:nth-child(even) td { background: #fafbff; }
`;

/* ---------------------------------- PPTX ---------------------------------- */

const EMU_PER_INCH = 914400;

function emuToInch(value) {
  return (Number(value) || 0) / EMU_PER_INCH;
}

function parseXml(xmlText) {
  return new DOMParserShim(xmlText);
}

/** Tiny namespace-agnostic XML reader (serverless-friendly, no deps). */
class DOMParserShim {
  constructor(text) {
    this.text = text;
  }

  findElements(tagName) {
    const regex = new RegExp(`<((?:[\\w.-]+:)?${tagName})\\b([^>]*?)(/?)>`, "g");
    const results = [];
    let match;
    while ((match = regex.exec(this.text))) {
      const attrs = {};
      const attrRegex = /([\w:-]+)\s*=\s*"([^"]*)"/g;
      let attrMatch;
      while ((attrMatch = attrRegex.exec(match[2]))) attrs[attrMatch[1]] = attrMatch[2];
      const selfClosing = match[3] === "/";
      let inner = "";
      if (!selfClosing) {
        const startIndex = regex.lastIndex;
        const endTag = `</${match[1]}>`;
        const endIndex = this.text.indexOf(endTag, startIndex);
        if (endIndex !== -1) inner = this.text.slice(startIndex, endIndex);
      }
      results.push({ tag: match[1], attrs, inner, selfClosing });
    }
    return results;
  }

  attr(tagName, attrName) {
    const els = this.findElements(tagName);
    return els.length ? els[0].attrs[attrName] : undefined;
  }
}

function colorFromNode(inner, tagName) {
  const node = parseXml(inner).findElements(tagName)[0];
  if (!node) return null;
  if (node.attrs["a:val"] || node.attrs.val) {
    const val = node.attrs["a:val"] || node.attrs.val;
    if (/^[0-9A-Fa-f]{6}$/.test(val) || /^[0-9A-Fa-f]{8}$/.test(val)) return `#${val.slice(0, 6)}`;
    return null;
  }
  return null;
}

function parseTextRuns(paragraphInner, theme) {
  const runs = [];
  const pXml = parseXml(paragraphInner);
  const pPr = pXml.findElements("a:pPr")[0];
  let align = "start";
  let level = 0;
  if (pPr) {
    const attr = pPr.attrs;
    if (attr.algn) align = { r: "right", l: "left", ctr: "center", just: "justify", dist: "justify" }[attr.algn] || "start";
    level = Number(attr.lvl || 0);
  }
  const runEls = pXml.findElements("a:r");
  for (const run of runEls) {
    const inner = run.inner;
    const tMatch = inner.match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/);
    const text = tMatch ? tMatch[1] : "";
    if (!text) continue;
    const rPr = parseXml(inner).findElements("a:rPr")[0]?.attrs || {};
    const size = rPr.sz ? Number(rPr.sz) / 100 : null;
    const bold = rPr.b === "1";
    const italic = rPr.i === "1";
    const color = colorFromNode(inner, "a:solidFill") || theme.textColor;
    runs.push({ text, size, bold, italic, color });
  }
  if (!runs.length) {
    const tMatch = paragraphInner.match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/);
    if (tMatch) runs.push({ text: tMatch[1], size: null, bold: false, color: theme.textColor });
  }
  return { runs, align, level };
}

export async function pptxToHtml(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const presentationXml = await zip.file("ppt/presentation.xml")?.async("string");
  if (!presentationXml) throw new Error("ملف PPTX غير صالح / invalid PPTX");
  const sizeXml = parseXml(presentationXml);
  const sldSz = sizeXml.findElements("p:sldSz")[0]?.attrs || {};
  const slideWidthIn = emuToInch(sldSz.cx) || 10;
  const slideHeightIn = emuToInch(sldSz.cy) || 7.5;

  const themeColor = "#111111";
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/slide(\d+)\.xml/)[1]) - Number(b.match(/slide(\d+)\.xml/)[1]));

  const slides = [];
  for (const fileName of slideFiles) {
    const xml = await zip.file(fileName).async("string");
    const relsName = fileName.replace("slides/", "slides/_rels/") + ".rels";
    const relsXml = (await zip.file(relsName)?.async("string")) || "";
    const rels = {};
    for (const rel of parseXml(relsXml).findElements("Relationship")) {
      rels[rel.attrs.Id] = rel.attrs.Target;
    }
    const slide = parseXml(xml);
    const bgMatch = slide.text.match(/<p:bg>[\s\S]*?<\/p:bg>/);
    const background = bgMatch ? colorFromNode(bgMatch[0], "a:srgbClr") : null;
    const treeShapes = [];
    for (const shape of slide.findElements("p:sp")) {
      const spPrMatch = shape.inner.match(/<p:spPr[\s\S]*?<\/p:spPr>/);
      const xfrm = spPrMatch ? parseXml(spPrMatch[0]).findElements("a:xfrm")[0] : null;
      const off = xfrm ? parseXml(xfrm.inner || "").findElements("a:off")[0]?.attrs : null;
      const ext = xfrm ? parseXml(xfrm.inner || "").findElements("a:ext")[0]?.attrs : null;
      const geom = shape.inner.match(/<a:prstGeom[^>]*prst="([^"]+)"/);
      const fill = spPrMatch ? colorFromNode(spPrMatch[0].replace(/<a:ln[\s\S]*?<\/a:ln>/g, ""), "a:srgbClr") : null;
      const paragraphs = [];
      for (const p of parseXml(shape.inner).findElements("a:p")) {
        const parsed = parseTextRuns(p.inner, { textColor: themeColor });
        if (parsed.runs.length) paragraphs.push(parsed);
      }
      treeShapes.push({
        kind: "text",
        x: emuToInch(off?.x), y: emuToInch(off?.y),
        w: emuToInch(ext?.cx), h: emuToInch(ext?.cy),
        fill, geom: geom ? geom[1] : null, paragraphs,
      });
    }
    for (const pic of slide.findElements("p:pic")) {
      const blip = pic.inner.match(/r:embed="([^"]+)"/);
      const xfrmMatch = pic.inner.match(/<a:xfrm[\s\S]*?<\/a:xfrm>/);
      const off = xfrmMatch ? parseXml(xfrmMatch[0]).findElements("a:off")[0]?.attrs : null;
      const ext = xfrmMatch ? parseXml(xfrmMatch[0]).findElements("a:ext")[0]?.attrs : null;
      let dataUri = null;
      if (blip && rels[blip[1]]) {
        const target = `ppt/${rels[blip[1]].replace(/^\.\.\//, "")}`;
        const file = zip.file(target);
        if (file) {
          const content = await file.async("base64");
          const ext2 = target.split(".").pop().toLowerCase();
          const mime = ext2 === "png" ? "image/png" : ext2 === "svg" ? "image/svg+xml" : "image/jpeg";
          dataUri = `data:${mime};base64,${content}`;
        }
      }
      treeShapes.push({
        kind: "image", src: dataUri,
        x: emuToInch(off?.x), y: emuToInch(off?.y),
        w: emuToInch(ext?.cx), h: emuToInch(ext?.cy),
      });
    }
    slides.push({ shapes: treeShapes, background });
  }

  const slideHtml = slides.map((slide, index) => {
    const shapesHtml = slide.shapes.map((shape) => {
      const style = [
        `left:${shape.x}in`, `top:${shape.y}in`,
        `width:${Math.max(shape.w, 0.1)}in`, `height:${Math.max(shape.h, 0.1)}in`,
      ];
      if (shape.kind === "image") {
        if (!shape.src) return "";
        return `<div class="shape" style="${style.join(";")}"><img src="${shape.src}" style="width:100%;height:100%;object-fit:contain"></div>`;
      }
      if (shape.fill) style.push(`background:${shape.fill}`);
      if (shape.geom && /roundRect|ellipse|rect/.test(shape.geom)) style.push(`border-radius:${shape.geom === "ellipse" ? "50%" : shape.geom === "roundRect" ? "0.25in" : "0"}`);
      const paragraphsHtml = shape.paragraphs.map((p) => {
        const align = p.align === "start" ? "right" : p.align;
        const runsHtml = p.runs.map((run) => {
          const s = [];
          if (run.size) s.push(`font-size:${run.size}pt`);
          if (run.bold) s.push("font-weight:700");
          if (run.italic) s.push("font-style:italic");
          if (run.color) s.push(`color:${run.color}`);
          return `<span style="${s.join(";")}">${escapeHtml(run.text)}</span>`;
        }).join("");
        return `<p style="text-align:${align === "justify" ? "justify" : align};margin:0 0 4pt;line-height:1.25">${runsHtml}</p>`;
      }).join("");
      return `<div class="shape" style="${style.join(";")}"><div class="text">${paragraphsHtml}</div></div>`;
    }).join("");
    const bg = slide.background ? `background:${slide.background};` : "";
    return `<div class="slide" style="width:${slideWidthIn}in;height:${slideHeightIn}in;${bg}page-break-after:${index === slides.length - 1 ? "auto" : "always"}">${shapesHtml}</div>`;
  }).join("");

  return {
    html: slideHtml,
    slideWidth: slideWidthIn,
    slideHeight: slideHeightIn,
    slides: slides.length,
    css: `
      .slide { position: relative; overflow: hidden; background: #fff; margin: 0 auto; }
      .slide .shape { position: absolute; }
      .slide .text { padding: 2pt; }
      @page { size: ${slideWidthIn}in ${slideHeightIn}in; margin: 0 !important; }
      body { padding: 0 !important; }
    `,
  };
}

/* ------------------------- Builders (PDF -> Office) ------------------------ */

const SENTENCE_END = /[.؟!:؛،»]\s*$/;

/** Merges wrapped lines of the same block back into readable paragraphs. */
function mergeLines(lines) {
  const merged = [];
  for (const line of lines) {
    const previous = merged[merged.length - 1];
    const closeVertically = previous && Number.isFinite(line.y) && Number.isFinite(previous.bottomY)
      ? previous.y - line.y <= line.size * 1.95
      : true;
    const sameSize = previous && Math.abs(previous.size - line.size) <= Math.max(0.6, line.size * 0.12);
    const continues = previous && !SENTENCE_END.test(previous.text) && closeVertically && sameSize;
    if (continues) {
      previous.text = `${previous.text} ${line.text}`.replace(/\s{2,}/g, " ");
    } else {
      merged.push({ ...line, bottomY: line.y });
    }
  }
  return merged;
}

export async function buildDocx(pages, { title = "Converted document", rtl = true } = {}) {
  const { Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel } = await import("docx");
  const sizes = pages.flatMap((page) => page.lines.map((line) => line.size)).sort((a, b) => a - b);
  const median = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 11;
  const children = [];
  for (const page of pages) {
    for (const line of mergeLines(page.lines)) {
      const isHeading = line.size >= median * 1.35;
      const arabic = line.rtl || rtl;
      children.push(new Paragraph({
        alignment: arabic ? AlignmentType.RIGHT : AlignmentType.LEFT,
        heading: isHeading ? (line.size >= median * 1.8 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2) : undefined,
        spacing: { after: Math.round(median * 4) },
        bidirectional: arabic,
        children: [new TextRun({
          text: line.text,
          bold: isHeading,
          rightToLeft: arabic,
          size: Math.round(Math.min(32, Math.max(9, line.size)) * 2),
        })],
      }));
    }
    if (page !== pages[pages.length - 1]) {
      children.push(new Paragraph({ text: "", pageBreakBefore: true }));
    }
  }
  const doc = new Document({
    title,
    creator: "Eltaranisi Service+",
    description: "Converted with Eltaranisi Service+",
    styles: { default: { document: { run: { font: "Arial", size: 22 } } } },
    sections: [{ children }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

export async function buildXlsx(sheets) {
  const workbook = XLSX.utils.book_new();
  sheets.forEach((sheet, index) => {
    const rows = sheet.rows.length ? sheet.rows : [[""]];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const maxCols = Math.max(...rows.map((r) => r.length));
    ws["!cols"] = Array.from({ length: maxCols }, () => ({ wch: 24 }));
    XLSX.utils.book_append_sheet(workbook, ws, `Page ${sheet.page || index + 1}`);
  });
  const out = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  return Buffer.from(out);
}

export function buildTxt(pages) {
  return Buffer.from(pages.map((page) => page.lines.map((l) => l.text).join("\n")).join("\n\n---\n\n"), "utf8");
}

export async function csvToXlsx(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", raw: false });
  const out = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  return Buffer.from(out);
}

export function xlsxToCsv(buffer) {
  const workbook = readWorkbook(buffer);
  const lines = [];
  for (const name of workbook.SheetNames) {
    lines.push(`# ${name}`);
    lines.push(XLSX.utils.sheet_to_csv(workbook.Sheets[name]));
    lines.push("");
  }
  return Buffer.from(lines.join("\n"), "utf8");
}

export function csvToHtml(buffer) {
  const text = buffer.toString("utf8");
  const rows = text.split(/\r?\n/).filter((line) => line.trim() !== "").map((line) => {
    const cells = [];
    let current = "";
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { current += '"'; i += 1; }
        else if (ch === '"') quoted = false;
        else current += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ",") { cells.push(current); current = ""; }
      else current += ch;
    }
    cells.push(current);
    return cells;
  });
  const head = rows[0] || [];
  const body = rows.slice(1);
  const rtl = rows.some((row) => row.some((cell) => hasArabicScript(cell)));
  return {
    rtl,
    html: `<table><thead><tr>${head.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead>
      <tbody>${body.map((row) => `<tr>${row.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`,
  };
}
