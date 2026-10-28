import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { createRequire } from "node:module";

// Resolve the worker explicitly so serverless bundles (Vercel/nft) can find it.
try {
  const require = createRequire(import.meta.url);
  const workerPath = require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = workerPath;
} catch {
  /* the legacy build falls back to its own resolution */
}
import { createCanvas } from "@napi-rs/canvas";
import {
  arabicPlausibility, fixExtractedLine, hasArabic, hasPresentationForms, normalizeArabicForms, visualToLogical,
} from "./arabic.mjs";

const PDFJS_OPTIONS = {
  isEvalSupported: false,
  useSystemFonts: false,
  disableFontFace: true,
  standardFontDataUrl: undefined,
};

export async function openPdfJs(buffer) {
  const data = new Uint8Array(buffer);
  const task = pdfjs.getDocument({ ...PDFJS_OPTIONS, data, verbosity: 0 });
  const doc = await task.promise;
  return doc;
}

/** Renders pages to image buffers. Returns points + pixels metadata. */
export async function renderPdfPages(buffer, { dpi = 150, format = "png", quality = 0.9, maxPages = 200, pages = null } = {}) {
  const doc = await openPdfJs(buffer);
  const scale = dpi / 72;
  const results = [];
  const indices = pages || Array.from({ length: Math.min(doc.numPages, maxPages) }, (_, i) => i + 1);
  for (const pageNumber of indices) {
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    const data = format === "jpeg"
      ? canvas.toBuffer("image/jpeg", quality)
      : canvas.toBuffer("image/png");
    const base = page.getViewport({ scale: 1 });
    results.push({
      data,
      page: pageNumber,
      width: canvas.width,
      height: canvas.height,
      widthPt: base.width,
      heightPt: base.height,
    });
    page.cleanup();
  }
  await doc.destroy();
  return results;
}

function groupIntoLines(items) {
  const usable = items.filter((item) => item.str && item.str.length > 0);
  const lines = [];
  for (const item of usable) {
    const x = item.transform[4];
    const y = item.transform[5];
    const size = Math.abs(item.transform[3]) || item.height || 10;
    let line = lines.find((l) => Math.abs(l.y - y) <= Math.max(2.5, size * 0.45));
    if (!line) {
      line = { y, items: [] };
      lines.push(line);
    }
    line.items.push({ x, size, str: item.str, dir: item.dir || "ltr", width: item.width || 0 });
  }
  lines.sort((a, b) => b.y - a.y);
  for (const line of lines) {
    line.streamItems = [...line.items];
    line.items.sort((a, b) => a.x - b.x);
    line.size = Math.max(...line.items.map((i) => i.size));
  }
  return lines;
}

const ARABIC_CHAR = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;

function joinItems(items, { useGaps = true } = {}) {
  let out = "";
  let prevEnd = null;
  for (const item of items) {
    const text = item.str;
    if (useGaps && prevEnd !== null) {
      const gap = item.x - prevEnd;
      const needsSpace = gap > Math.max(1.6, (item.size || 10) * 0.22);
      if (needsSpace && !/\s$/.test(out) && !/^\s/.test(text)) out += " ";
    }
    out += text;
    prevEnd = item.x + (item.width || 0);
  }
  return out;
}

/**
 * Reassembles one line from its items.
 * PDF writers (Chromium/Word/LibreOffice) emit each glyph group once, in visual
 * left-to-right position, while the characters *inside* a group stay logical.
 * So for an RTL line the group order must be reversed, keeping groups intact.
 */
function assembleItems(items) {
  // each unit keeps the visual gap that precedes it, so word spaces survive the reversal
  const units = [];
  let i = 0;
  let previousEnd = null;
  const gapBefore = (item) => {
    if (previousEnd === null) return 0;
    return item.x - previousEnd;
  };
  while (i < items.length) {
    const item = items[i];
    if (item.str.trim() === "" || /^[\s\u00A0]+$/.test(item.str)) {
      units.push({ text: " ", gap: gapBefore(item), kind: "space" });
      previousEnd = item.x + (item.width || 0);
      i += 1;
      continue;
    }
    if (ARABIC_CHAR.test(item.str)) {
      units.push({ text: item.str.replace(/^ +| +$/g, ""), gap: gapBefore(item), kind: "rtl", size: item.size });
      previousEnd = item.x + (item.width || 0);
      i += 1;
      continue;
    }
    // Latin/digit phrase: keep its own left-to-right order and inner spaces intact
    let text = item.str;
    const startItem = item;
    let end = item.x + (item.width || 0);
    const gap = gapBefore(item);
    i += 1;
    for (;;) {
      let j = i;
      let spaces = "";
      while (j < items.length && items[j].str.trim() === "") {
        spaces += items[j].str;
        end = items[j].x + (items[j].width || 0);
        j += 1;
      }
      if (j < items.length && !ARABIC_CHAR.test(items[j].str)) {
        text += spaces + items[j].str;
        end = items[j].x + (items[j].width || 0);
        i = j + 1;
      } else break;
    }
    units.push({ text, gap, kind: "ltr", size: startItem.size });
    previousEnd = end;
  }

  const reversed = [...units].reverse();
  // drop duplicated/leading spaces and rebuild word boundaries from visual gaps
  let out = "";
  for (let k = 0; k < reversed.length; k += 1) {
    const unit = reversed[k];
    if (unit.kind === "space") {
      if (out && !/\s$/.test(out)) out += " ";
      continue;
    }
    const next = reversed[k + 1];
    const nextSize = next?.size || unit.size || 10;
    const needsGap = Boolean(next) && next.kind !== "space"
      ? (next.kind === "ltr" && unit.kind === "ltr"
        ? next.gap > Math.max(2, nextSize * 0.3)
        : next.kind !== unit.kind && next.gap > 0.5)
      : false;
    out += unit.text;
    if (needsGap) out += " ";
  }
  out = out
    .replace(/\s+([\u060C\u061B\u061F])/g, "$1")
    .replace(/%\s?(\d)/g, "$1%")
    .replace(/(\d)%(\d)/g, "$1$2%")
    .replace(/\s{2,}/g, " ")
    .trim();
  // keep trailing punctuation attached to the final Latin word ("Test." not ".Test")
  const trailing = out.match(/^([.,;:!?])([A-Za-z0-9]+)$/);
  if (trailing) out = `${trailing[2]}${trailing[1]}`;
  return out;
}

/**
 * Decides the logical text of one visual line.
 * - Chromium / Word / LibreOffice put every glyph group once, in visual order,
 *   so geometric assembly (reverse group order) gives the logical text.
 * - Legacy PDFs store presentation forms: fall back to scored candidate matching.
 */
function finalizeText(value) {
  let text = String(value).trim();
  // a period/comma that visually sat before the final Latin word belongs after it
  text = text.replace(/(^|\s)([.,;:!?])([A-Za-z0-9]+)\s*$/, "$1$3$2");
  // a leading punctuation mark of a Latin phrase belongs at its end
  text = text.replace(/^([.,;:!?])([A-Za-z][\s\S]*)$/, (_m, mark, rest) => (
    /[.,;:!?]$/.test(rest) ? `${rest}` : `${rest}${mark}`
  ));
  // sign placement around percentages/numbers ("5%+" -> "+5%", "2%-" -> "-2%")
  text = text.replace(/^(-?\d[\d.,]*%?)([+\-])$/, "$2$1").replace(/^([+\-])([+\-])(\d)/, "$2$3");
  return text;
}

function chooseLineText(line) {
  const raw = joinItems(line.items);
  if (!hasArabic(raw)) return finalizeText(raw);
  const assembled = assembleItems(line.items);
  let chosen;
  if (line.items.length > 1) {
    // modern writers (Chromium, Word, LibreOffice): one item per glyph group, in visual order
    chosen = assembled;
  } else if (hasPresentationForms(raw)) {
    // legacy writer that stored a full visual line in a single run
    chosen = visualToLogical(raw);
  } else {
    const mirrored = visualToLogical(raw);
    chosen = arabicPlausibility(mirrored) > arabicPlausibility(raw) + 5 ? mirrored : raw;
  }
  return finalizeText(normalizeArabicForms(chosen));
}

/** Extracts structured text (lines with size + alignment hints) from a PDF. */
export async function extractPdfStructure(buffer, { maxPages = 400 } = {}) {
  const doc = await openPdfJs(buffer);
  const pages = [];
  const count = Math.min(doc.numPages, maxPages);
  for (let p = 1; p <= count; p += 1) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const rawLines = groupIntoLines(content.items);
    const lines = rawLines.map((line) => {
      let text = chooseLineText(line);
      // a neutral punctuation mark that visually landed before an RTL/LTR run belongs at the end
      if (/^[.,;:!?]/.test(text) && /[0-9A-Za-z\u0621-\u064A]/.test(text.slice(1))) {
        text = `${text.slice(1)}${text[0]}`;
      }
      const first = line.items[0];
      const last = line.items[line.items.length - 1];
      return {
        text,
        size: Math.round(line.size * 10) / 10,
        y: Math.round(line.y * 10) / 10,
        x: first ? first.x : 0,
        right: last ? last.x + (last.width || 0) : 0,
        rtl: hasArabic(text),
      };
    }).filter((line) => /[\u0621-\u064A0-9A-Za-z]/.test(line.text));
    const viewport = page.getViewport({ scale: 1 });
    pages.push({ page: p, width: viewport.width, height: viewport.height, lines });
    page.cleanup();
  }
  await doc.destroy();
  return pages;
}

/**
 * Table/row extraction used by the PDF -> Excel converter.
 * Cells are split on the widest visual gaps (relative to the line's median gap),
 * then each cell is assembled into correct logical order.
 */
export async function extractPdfGrid(buffer, { maxPages = 60 } = {}) {
  const doc = await openPdfJs(buffer);
  const count = Math.min(doc.numPages, maxPages);
  const sheets = [];
  for (let p = 1; p <= count; p += 1) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const rawLines = groupIntoLines(content.items);
    const rows = [];
    let arabicCells = 0;
    let totalCells = 0;
    for (const line of rawLines) {
      const items = line.items.filter((item) => item.str !== "");
      if (!items.length) continue;
      const size = line.size || 10;
      const solidIndexes = items.map((item, index) => ({ item, index }))
        .filter(({ item }) => item.str.trim() !== "")
        .map(({ index }) => index);
      if (!solidIndexes.length) continue;

      const gaps = [];
      for (let k = 1; k < solidIndexes.length; k += 1) {
        const previous = items[solidIndexes[k - 1]];
        const current = items[solidIndexes[k]];
        gaps.push(current.x - (previous.x + (previous.width || 0)));
      }
      const sorted = [...gaps].sort((a, b) => a - b);
      const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
      const threshold = Math.max(median * 4, size * 2.5, 8);

      const groups = [];
      let groupStart = solidIndexes[0];
      let groupEnd = solidIndexes[0];
      for (let k = 1; k < solidIndexes.length; k += 1) {
        if (gaps[k - 1] > threshold) {
          groups.push([groupStart, groupEnd]);
          groupStart = solidIndexes[k];
        }
        groupEnd = solidIndexes[k];
      }
      groups.push([groupStart, groupEnd]);

      const texts = groups
        .map(([a, b]) => chooseLineText({ items: items.slice(a, b + 1), size }))
        .filter((text) => text !== "" && /[\u0621-\u064A0-9A-Za-z]/.test(text));
      if (!texts.length) continue;
      texts.forEach((text) => {
        totalCells += 1;
        if (hasArabic(text)) arabicCells += 1;
      });
      rows.push(texts);
    }
    const rtlPage = totalCells > 0 && arabicCells / totalCells > 0.2;
    if (rows.length) {
      sheets.push({ page: p, rows: rows.map((row) => (rtlPage ? [...row].reverse() : row)) });
    }
    page.cleanup();
  }
  await doc.destroy();
  return sheets;
}

/** Embedded text presence check (to detect scanned PDFs). */
export async function pdfHasTextLayer(buffer) {
  const doc = await openPdfJs(buffer);
  let chars = 0;
  const pages = Math.min(doc.numPages, 3);
  for (let p = 1; p <= pages; p += 1) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    chars += content.items.reduce((sum, item) => sum + (item.str ? item.str.trim().length : 0), 0);
    page.cleanup();
  }
  await doc.destroy();
  return chars > 20;
}
