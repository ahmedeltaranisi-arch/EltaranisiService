import {
  arabicPlausibility, hasArabic, hasPresentationForms, normalizeArabicForms, visualToLogical,
} from "./arabic.mjs";

/* Pure text-assembly helpers shared by the Node engine and the browser engine.
   They take pdf.js text items and rebuild logical (readable) Arabic lines. */

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
    if (/^[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]+$/.test(unit.text) && out) {
      out += unit.text; // a standalone diacritic belongs to the previous letter
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


export { groupIntoLines, chooseLineText, assembleItems, joinItems };

/** Splits one line into cells on wide visual gaps (table columns). */
export function splitCells(line) {
  const lineItems = line.items.filter((item) => item.str !== "");
  if (!lineItems.length) return [];
  const size = line.size || 10;
  const solid = lineItems.map((item, index) => ({ item, index }))
    .filter(({ item }) => item.str.trim() !== "")
    .map(({ index }) => index);
  if (!solid.length) return [];
  const gaps = [];
  for (let k = 1; k < solid.length; k += 1) {
    const previous = lineItems[solid[k - 1]];
    const current = lineItems[solid[k]];
    gaps.push(current.x - (previous.x + (previous.width || 0)));
  }
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const threshold = Math.max(median * 4, size * 2.5, 12);
  const groups = [];
  let start = solid[0];
  let end = solid[0];
  for (let k = 1; k < solid.length; k += 1) {
    if (gaps[k - 1] > threshold) {
      groups.push([start, end]);
      start = solid[k];
    }
    end = solid[k];
  }
  groups.push([start, end]);
  return groups
    .map(([a, b]) => chooseLineText({ items: lineItems.slice(a, b + 1), size }))
    .filter((text) => text !== "");
}

/** Builds structured lines for one page from pdf.js text items. */
export function structuredLines(items) {
  const rawLines = groupIntoLines(items);
  return rawLines.map((line) => {
    const cells = splitCells(line);
    const text = cells.length > 1 ? cells.join(" | ") : chooseLineText(line);
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
}

/** Builds table rows (cells split on wide visual gaps) for one page. */
export function tableRows(items) {
  const rawLines = groupIntoLines(items);
  const rows = [];
  for (const line of rawLines) {
    const lineItems = line.items.filter((item) => item.str !== "");
    if (!lineItems.length) continue;
    const size = line.size || 10;
    const solidIndexes = lineItems.map((item, index) => ({ item, index }))
      .filter(({ item }) => item.str.trim() !== "")
      .map(({ index }) => index);
    if (!solidIndexes.length) continue;

    const gaps = [];
    for (let k = 1; k < solidIndexes.length; k += 1) {
      const previous = lineItems[solidIndexes[k - 1]];
      const current = lineItems[solidIndexes[k]];
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
      .map(([a, b]) => chooseLineText({ items: lineItems.slice(a, b + 1), size }))
      .filter((text) => text !== "" && /[\u0621-\u064A0-9A-Za-z]/.test(text));
    if (texts.length) rows.push(texts);
  }
  return rows;
}

/** Merges wrapped lines into paragraphs (used for Word export). */
const SENTENCE_END = /[.؟!:؛،»]\s*$/;

export function mergeWrappedLines(lines) {
  const merged = [];
  for (const line of lines) {
    const previous = merged[merged.length - 1];
    const closeVertically = previous && Number.isFinite(line.y) && Number.isFinite(previous.y)
      ? previous.y - line.y <= line.size * 1.95
      : true;
    const sameSize = previous && Math.abs(previous.size - line.size) <= Math.max(0.6, line.size * 0.12);
    const continues = previous && !SENTENCE_END.test(previous.text) && closeVertically && sameSize;
    if (continues) {
      previous.text = `${previous.text} ${line.text}`.replace(/\s{2,}/g, " ");
    } else {
      merged.push({ ...line });
    }
  }
  return merged;
}
