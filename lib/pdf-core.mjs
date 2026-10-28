import {
  PDFDocument, PDFName, PDFString, degrees, rgb, StandardFonts,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import fs from "node:fs";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { shapeForPdf, hasArabic } from "./arabic.mjs";

const AMIRI_PATH = path.join(process.cwd(), "public", "fonts", "Amiri-Regular.ttf");
let amiriCache = null;
function amiriBytes() {
  if (!amiriCache) amiriCache = fs.readFileSync(AMIRI_PATH);
  return amiriCache;
}

/**
 * pdf-lib reads image bytes through `new DataView(bytes.buffer)` and ignores
 * byteOffset, so pooled Node buffers (busboy/undici) break JPEG parsing.
 * Always hand pdf-lib a zero-offset copy.
 */
export function freshBytes(data) {
  if (!data) return data;
  const source = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (source.byteOffset === 0 && source.byteLength === source.buffer.byteLength && source.buffer instanceof ArrayBuffer) {
    return source;
  }
  // a plain Uint8Array allocates an exact-size ArrayBuffer (no Node buffer pooling),
  // which is what pdf-lib's `new DataView(bytes.buffer)` expects.
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy;
}

/** Wraps a page's existing content in q/Q so leftover clips/state can't hide new drawings. */
export function isolatePageContent(page) {
  const context = page.doc.context;
  try {
    page.node.wrapContentStreams(
      context.getPushGraphicsStateContentStream(),
      context.getPopGraphicsStateContentStream(),
    );
  } catch {
    /* already isolated */
  }
}

export async function loadPdf(buffer, { ignoreEncryption = true } = {}) {
  return PDFDocument.load(freshBytes(buffer), { ignoreEncryption, updateMetadata: false, throwOnInvalidObject: false });
}

export function parsePageRanges(input, pageCount) {
  const text = String(input || "").trim();
  if (!text) return Array.from({ length: pageCount }, (_, i) => i);
  const pages = new Set();
  for (const chunk of text.split(/[,;]+/)) {
    const part = chunk.trim();
    if (!part) continue;
    const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      let a = Number(range[1]);
      let b = Number(range[2]);
      if (a > b) [a, b] = [b, a];
      for (let p = a; p <= b; p += 1) if (p >= 1 && p <= pageCount) pages.add(p - 1);
      continue;
    }
    const single = Number(part);
    if (Number.isFinite(single) && single >= 1 && single <= pageCount) pages.add(single - 1);
  }
  return [...pages].sort((a, b) => a - b);
}

export async function mergePdfs(buffers) {
  const out = await PDFDocument.create();
  for (const buffer of buffers) {
    const doc = await loadPdf(buffer);
    const pages = await out.copyPages(doc, doc.getPageIndices());
    pages.forEach((page) => out.addPage(page));
  }
  return Buffer.from(await out.save({ useObjectStreams: true }));
}

export async function splitPdf(buffer, mode, ranges) {
  const src = await loadPdf(buffer);
  const total = src.getPageCount();
  const groups = [];
  if (mode === "each") {
    for (let i = 0; i < total; i += 1) groups.push({ name: `page-${i + 1}`, pages: [i] });
  } else if (mode === "chunks") {
    const size = Math.max(1, Number(ranges) || 1);
    for (let start = 0, part = 1; start < total; start += size, part += 1) {
      const pages = [];
      for (let i = start; i < Math.min(start + size, total); i += 1) pages.push(i);
      groups.push({ name: `part-${part}`, pages });
    }
  } else {
    const pages = parsePageRanges(ranges, total);
    if (!pages.length) throw new Error("لم يتم تحديد صفحات صحيحة / No valid pages selected");
    groups.push({ name: "extracted", pages });
  }

  const results = [];
  for (const group of groups) {
    const doc = await PDFDocument.create();
    const copied = await doc.copyPages(src, group.pages);
    copied.forEach((page) => doc.addPage(page));
    results.push({ name: `${group.name}.pdf`, data: Buffer.from(await doc.save({ useObjectStreams: true })) });
  }
  return results;
}

export async function organizePdf(buffer, order) {
  const src = await loadPdf(buffer);
  const total = src.getPageCount();
  const pages = String(order || "")
    .split(/[,;\s]+/)
    .map((n) => Number(n) - 1)
    .filter((n) => Number.isInteger(n) && n >= 0 && n < total);
  if (!pages.length) throw new Error("ترتيب الصفحات غير صالح / Invalid page order");
  const doc = await PDFDocument.create();
  const copied = await doc.copyPages(src, pages);
  copied.forEach((page) => doc.addPage(page));
  return Buffer.from(await doc.save({ useObjectStreams: true }));
}

export async function rotatePdf(buffer, angle, range) {
  const doc = await loadPdf(buffer);
  const total = doc.getPageCount();
  const targets = parsePageRanges(range, total);
  const rotation = Number(angle) || 90;
  targets.forEach((index) => {
    const page = doc.getPage(index);
    page.setRotation(degrees((page.getRotation().angle + rotation + 360) % 360));
  });
  return Buffer.from(await doc.save({ useObjectStreams: true }));
}

export async function cleanPdf(buffer) {
  const doc = await loadPdf(buffer);
  doc.setTitle("");
  doc.setAuthor("");
  doc.setSubject("");
  doc.setKeywords([]);
  doc.setProducer("Eltaranisi Service+");
  doc.setCreator("Eltaranisi Service+");
  return Buffer.from(await doc.save({ useObjectStreams: true, addDefaultPage: false }));
}

export async function addPageNumbers(buffer, options = {}) {
  const doc = await loadPdf(buffer);
  const { textToPng } = await import("./text-image.mjs");
  const {
    position = "bottom-center", startAt = 1, format = "{n} / {total}", fontSize = 11, skipFirst = false,
    color = "#4b5563",
  } = options;
  const pages = doc.getPages();
  const total = pages.length;
  for (let index = 0; index < total; index += 1) {
    if (skipFirst && index === 0) continue;
    const label = format.replace(/\{n\}/g, String(index + startAt)).replace(/\{total\}/g, String(total + startAt - 1));
    const page = pages[index];
    isolatePageContent(page);
    const size = Math.max(6, Math.min(72, Number(fontSize) || 11));
    const px = Math.round(size * 4);
    const rendered = textToPng(label, { size: px, color, padding: Math.round(px * 0.15) });
    const image = await doc.embedPng(freshBytes(rendered.png));
    const { width, height } = page.getSize();
    const drawWidth = (rendered.width / px) * size;
    const drawHeight = (rendered.height / px) * size;
    const margin = Math.max(14, size * 1.6);
    let x = (width - drawWidth) / 2;
    let y = margin;
    if (position.includes("right")) x = width - drawWidth - margin;
    if (position.includes("left")) x = margin;
    if (position.includes("top")) y = height - margin - drawHeight;
    page.drawImage(image, { x: Math.max(4, x), y: Math.max(4, y), width: drawWidth, height: drawHeight });
  }
  return Buffer.from(await doc.save({ useObjectStreams: true }));
}

export async function watermarkPdf(buffer, options = {}) {
  const doc = await loadPdf(buffer);
  const { textToPng } = await import("./text-image.mjs");
  const text = String(options.text || "Eltaranisi Service+").slice(0, 120);
  const size = Math.max(10, Math.min(160, Number(options.fontSize) || 56));
  const opacity = Math.min(1, Math.max(0.05, Number(options.opacity) || 0.16));
  const layout = options.layout || "diagonal";
  const color = options.color || "#5b48d6";
  const rendered = textToPng(text, { size: Math.round(size * 4), color, padding: Math.round(size * 0.4) });
  for (const page of doc.getPages()) {
    isolatePageContent(page);
    const image = await doc.embedPng(freshBytes(rendered.png));
    const { width, height } = page.getSize();
    let drawWidth = (rendered.width / (size * 4)) * size;
    let scale = 1;
    if (layout === "single") {
      // spread the text across the whole page width
      scale = Math.min(2.4, (width * 0.86) / drawWidth);
      drawWidth *= scale;
    }
    const drawHeight = (rendered.height / (size * 4)) * size * scale;
    const x = (width - drawWidth) / 2;
    const y = layout === "center" ? (height - drawHeight) / 2 : height * 0.32;
    page.drawImage(image, {
      x: Math.max(4, x),
      y: Math.max(4, y),
      width: drawWidth,
      height: drawHeight,
      opacity,
      rotate: layout === "diagonal" ? degrees(30) : degrees(0),
    });
  }
  return Buffer.from(await doc.save({ useObjectStreams: true }));
}

function guessImageType(name, buffer) {
  const ext = String(name || "").toLowerCase().split(".").pop();
  if (ext === "png") return "png";
  if (ext === "jpg" || ext === "jpeg") return "jpg";
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return "png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return "jpg";
  return "other";
}

/** Converts any decodable image (webp/heic-unaware) into jpeg/png bytes via canvas. */
export async function normalizeImage(name, buffer, target = "jpg", quality = 0.92) {
  const type = guessImageType(name, buffer);
  if (type === target) return buffer;
  const img = await loadImage(buffer);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  if (target === "jpg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, img.width, img.height);
  }
  ctx.drawImage(img, 0, 0);
  return target === "png" ? canvas.toBuffer("image/png") : canvas.toBuffer("image/jpeg", quality);
}

export async function imagesToPdf(files, options = {}) {
  const { pageSize = "fit", orientation = "portrait", margin = 0 } = options;
  const doc = await PDFDocument.create();
  const A4 = [595.28, 841.89];
  for (const file of files) {
    let type = guessImageType(file.name, file.data);
    let data = file.data;
    if (type === "other") {
      data = await normalizeImage(file.name, file.data, "jpg");
      type = "jpg";
    }
    let safe = freshBytes(data);
    const isPng = (bytes) => bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const isJpeg = (bytes) => bytes.length > 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
    const valid = type === "png" ? isPng(safe) : isJpeg(safe);
    if (!valid) {
      // repair path: decode whatever we received and re-encode it cleanly
      const repaired = await normalizeImage(file.name, file.data, type === "png" ? "png" : "jpg");
      safe = freshBytes(repaired);
      if (type === "png" ? !isPng(safe) : !isJpeg(safe)) {
        throw new Error(`تعذر قراءة الصورة ${file.name} — تأكد أن الملف صورة صالحة`);
      }
    }
    const image = type === "png" ? await doc.embedPng(safe) : await doc.embedJpg(safe);
    let pageWidth;
    let pageHeight;
    if (pageSize === "fit") {
      pageWidth = image.width + Number(margin) * 2;
      pageHeight = image.height + Number(margin) * 2;
    } else {
      const dims = {
        A4: [595.28, 841.89], A3: [841.89, 1190.55], A5: [419.53, 595.28], Letter: [612, 792],
      }[pageSize] || A4;
      [pageWidth, pageHeight] = orientation === "landscape" ? [dims[1], dims[0]] : dims;
    }
    const page = doc.addPage([pageWidth, pageHeight]);
    const availableWidth = pageWidth - Number(margin) * 2;
    const availableHeight = pageHeight - Number(margin) * 2;
    const scale = Math.min(availableWidth / image.width, availableHeight / image.height, pageSize === "fit" ? 1 : 1);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    page.drawImage(image, {
      x: (pageWidth - drawWidth) / 2,
      y: (pageHeight - drawHeight) / 2,
      width: drawWidth,
      height: drawHeight,
    });
  }
  return Buffer.from(await doc.save({ useObjectStreams: true }));
}

/** Strong compression: rasterise every page to JPEG inside a fresh PDF. */
export async function rasterizePdfToPdf(buffer, { dpi = 130, quality = 0.72 } = {}) {
  const { renderPdfPages } = await import("./pdf-render.mjs");
  const doc = await PDFDocument.create();
  const rendered = await renderPdfPages(buffer, { dpi, format: "jpeg", quality });
  for (const page of rendered) {
    const image = await doc.embedJpg(freshBytes(page.data));
    const pdfPage = doc.addPage([page.widthPt, page.heightPt]);
    pdfPage.drawImage(image, { x: 0, y: 0, width: page.widthPt, height: page.heightPt });
  }
  return Buffer.from(await doc.save({ useObjectStreams: true }));
}

export async function stripAnnotations(buffer) {
  const doc = await loadPdf(buffer);
  for (const page of doc.getPages()) {
    isolatePageContent(page);
    const annots = page.node.Annots();
    if (annots) page.node.delete(PDFName.of("Annots"));
  }
  return Buffer.from(await doc.save({ useObjectStreams: true }));
}

export async function pdfInfo(buffer) {
  const doc = await loadPdf(buffer);
  const pages = doc.getPages();
  return {
    pages: pages.length,
    pageSizes: pages.slice(0, 3).map((p) => p.getSize()),
    title: doc.getTitle() || "",
  };
}

export { StandardFonts };
