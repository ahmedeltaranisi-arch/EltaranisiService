// In-browser PDF operations (no upload, no 4.5 MB platform limit).
import { PDFDocument, degrees } from "pdf-lib";
import JSZip from "jszip";
import { openDocument, renderPage, canvasToBlob } from "./pdfjs.js";

export const bytesOf = async (file) => new Uint8Array(await file.arrayBuffer());

export function parseRanges(input, pageCount) {
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

async function load(file) {
  return PDFDocument.load(await bytesOf(file), { ignoreEncryption: true, updateMetadata: false });
}

export async function merge(files) {
  const out = await PDFDocument.create();
  for (const file of files) {
    const doc = await load(file);
    const pages = await out.copyPages(doc, doc.getPageIndices());
    pages.forEach((page) => out.addPage(page));
  }
  return { blob: new Blob([await out.save()], { type: "application/pdf" }), name: "merged.pdf" };
}

export async function split(file, options = {}) {
  const src = await load(file);
  const total = src.getPageCount();
  const base = file.name.replace(/\.[^.]+$/, "");
  const mode = options.mode || "ranges";

  if (mode === "ranges") {
    const pages = parseRanges(options.ranges, total);
    if (!pages.length) throw new Error("لم يتم تحديد صفحات صحيحة");
    const doc = await PDFDocument.create();
    (await doc.copyPages(src, pages)).forEach((page) => doc.addPage(page));
    return { blob: new Blob([await doc.save()], { type: "application/pdf" }), name: `${base}-pages.pdf` };
  }

  const groups = [];
  if (mode === "each") {
    for (let i = 0; i < total; i += 1) groups.push({ name: `page-${i + 1}.pdf`, pages: [i] });
  } else {
    const size = Math.max(1, Number(options.ranges) || 1);
    for (let start = 0, part = 1; start < total; start += size, part += 1) {
      const pages = [];
      for (let i = start; i < Math.min(start + size, total); i += 1) pages.push(i);
      groups.push({ name: `part-${part}.pdf`, pages });
    }
  }

  const zip = new JSZip();
  for (const group of groups) {
    const doc = await PDFDocument.create();
    (await doc.copyPages(src, group.pages)).forEach((page) => doc.addPage(page));
    zip.file(group.name, await doc.save());
  }
  return {
    blob: await zip.generateAsync({ type: "blob", compression: "DEFLATE" }),
    name: `${base}-split.zip`,
  };
}

export async function organize(file, order) {
  const src = await load(file);
  const total = src.getPageCount();
  const pages = String(order || "")
    .split(/[,;\s]+/)
    .map((n) => Number(n) - 1)
    .filter((n) => Number.isInteger(n) && n >= 0 && n < total);
  if (!pages.length) throw new Error("ترتيب الصفحات غير صالح");
  const doc = await PDFDocument.create();
  (await doc.copyPages(src, pages)).forEach((page) => doc.addPage(page));
  return {
    blob: new Blob([await doc.save()], { type: "application/pdf" }),
    name: `${file.name.replace(/\.[^.]+$/, "")}-organized.pdf`,
  };
}

export async function rotate(file, options = {}) {
  const doc = await load(file);
  const angle = Number(options.angle) || 90;
  const targets = parseRanges(options.pages, doc.getPageCount());
  targets.forEach((index) => {
    const page = doc.getPage(index);
    page.setRotation(degrees((page.getRotation().angle + angle + 360) % 360));
  });
  return {
    blob: new Blob([await doc.save()], { type: "application/pdf" }),
    name: `${file.name.replace(/\.[^.]+$/, "")}-rotated.pdf`,
  };
}

/** Chromium-style text drawing: render the label with canvas (correct Arabic shaping). */
async function textPng(text, { sizePx = 48, color = "#5b48d6", font = "DocSans" } = {}) {
  await ensureFonts();
  const measure = document.createElement("canvas").getContext("2d");
  const cssFont = `700 ${sizePx}px ${font}, "Almarai", sans-serif`;
  measure.font = cssFont;
  const width = Math.ceil(measure.measureText(text).width) + sizePx;
  const height = Math.ceil(sizePx * 1.7);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(4, width);
  canvas.height = Math.max(4, height);
  const ctx = canvas.getContext("2d");
  ctx.font = cssFont;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.direction = "rtl";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  return { bytes: new Uint8Array(await (await canvasToBlob(canvas, "image/png")).arrayBuffer()), width: canvas.width, height: canvas.height };
}

let fontsPromise = null;
export function ensureFonts() {
  if (fontsPromise) return fontsPromise;
  const load = (family, url) => {
    try {
      const face = new FontFace(family, `url(${url})`);
      return face.load().then((loaded) => document.fonts.add(loaded)).catch(() => null);
    } catch {
      return Promise.resolve(null);
    }
  };
  fontsPromise = Promise.all([
    load("DocSans", "/fonts/Almarai-Regular.ttf"),
    load("DocSansBold", "/fonts/Almarai-Bold.ttf"),
  ]);
  return fontsPromise;
}

export async function watermark(file, options = {}) {
  const doc = await load(file);
  const text = String(options.text || "Eltaranisi Service+").slice(0, 120);
  const size = Math.max(10, Math.min(160, Number(options.fontSize) || 56));
  const opacity = Math.min(1, Math.max(0.05, Number(options.opacity) || 0.16));
  const layout = options.layout || "diagonal";
  const rendered = await textPng(text, { sizePx: Math.round(size * 4) });
  for (const page of doc.getPages()) {
    const image = await doc.embedPng(rendered.bytes);
    const { width, height } = page.getSize();
    let drawWidth = (rendered.width / (size * 4)) * size;
    let scale = 1;
    if (layout === "single") {
      scale = Math.min(2.4, (width * 0.86) / drawWidth);
      drawWidth *= scale;
    }
    const drawHeight = (rendered.height / (size * 4)) * size * scale;
    page.drawImage(image, {
      x: Math.max(4, (width - drawWidth) / 2),
      y: Math.max(4, layout === "center" ? (height - drawHeight) / 2 : height * 0.32),
      width: drawWidth,
      height: drawHeight,
      opacity,
      rotate: degrees(layout === "diagonal" ? 30 : 0),
    });
  }
  return {
    blob: new Blob([await doc.save()], { type: "application/pdf" }),
    name: `${file.name.replace(/\.[^.]+$/, "")}-watermark.pdf`,
  };
}

export async function pageNumbers(file, options = {}) {
  const doc = await load(file);
  const position = options.position || "bottom-center";
  const format = options.format || "{n} / {total}";
  const startAt = Number(options.startAt) || 1;
  const size = Math.max(6, Math.min(72, Number(options.fontSize) || 11));
  const pages = doc.getPages();
  const total = pages.length;
  for (let index = 0; index < total; index += 1) {
    const label = format.replace(/\{n\}/g, String(index + startAt)).replace(/\{total\}/g, String(total + startAt - 1));
    const rendered = await textPng(label, { sizePx: Math.round(size * 4), color: "#4b5563" });
    const image = await doc.embedPng(rendered.bytes);
    const page = pages[index];
    const { width, height } = page.getSize();
    const drawWidth = (rendered.width / (size * 4)) * size;
    const drawHeight = (rendered.height / (size * 4)) * size;
    const margin = Math.max(14, size * 1.6);
    let x = (width - drawWidth) / 2;
    let y = margin;
    if (position.includes("right")) x = width - drawWidth - margin;
    if (position.includes("left")) x = margin;
    if (position.includes("top")) y = height - margin - drawHeight;
    page.drawImage(image, { x: Math.max(4, x), y: Math.max(4, y), width: drawWidth, height: drawHeight });
  }
  return {
    blob: new Blob([await doc.save()], { type: "application/pdf" }),
    name: `${file.name.replace(/\.[^.]+$/, "")}-numbered.pdf`,
  };
}

export async function compress(file, options = {}, onProgress = () => {}) {
  const level = options.level || "medium";
  const before = file.size;
  const bytes = await bytesOf(file);

  if (level === "light") {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    doc.setProducer("Eltaranisi Service+");
    doc.setCreator("Eltaranisi Service+");
    const out = await doc.save({ useObjectStreams: true });
    return {
      blob: new Blob([out], { type: "application/pdf" }),
      name: `${file.name.replace(/\.[^.]+$/, "")}-compressed.pdf`,
      info: buildCompressInfo(before, out.length),
    };
  }

  const dpi = level === "strong" ? 95 : 130;
  const quality = level === "strong" ? 0.55 : 0.72;
  const doc = await openDocument(bytes);
  const total = doc.numPages;
  const out = await PDFDocument.create();
  for (let p = 1; p <= total; p += 1) {
    const page = await doc.getPage(p);
    const canvas = await renderPage(page, dpi);
    const blob = await canvasToBlob(canvas, "image/jpeg", quality);
    const image = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    const pdfPage = out.addPage([canvas.width * 0.75, canvas.height * 0.75]);
    pdfPage.drawImage(image, { x: 0, y: 0, width: canvas.width * 0.75, height: canvas.height * 0.75 });
    page.cleanup();
    onProgress(Math.round((p / total) * 100));
  }
  await doc.destroy();
  const rendered = await out.save({ useObjectStreams: true });
  if (rendered.length >= before) {
    const doc2 = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    const lighter = await doc2.save({ useObjectStreams: true });
    return {
      blob: new Blob([lighter], { type: "application/pdf" }),
      name: `${file.name.replace(/\.[^.]+$/, "")}-compressed.pdf`,
      info: buildCompressInfo(before, lighter.length),
    };
  }
  return {
    blob: new Blob([rendered], { type: "application/pdf" }),
    name: `${file.name.replace(/\.[^.]+$/, "")}-compressed.pdf`,
    info: buildCompressInfo(before, rendered.length),
  };
}

function buildCompressInfo(before, after) {
  return { before, after, saved: Math.max(0, before - after), savedPercent: before ? Math.round(((before - after) / before) * 100) : 0 };
}

export async function toImages(file, options = {}, format = "jpg", onProgress = () => {}) {
  const dpi = Math.min(300, Math.max(72, Number(options.dpi) || 150));
  const doc = await openDocument(await bytesOf(file));
  const total = doc.numPages;
  const base = file.name.replace(/\.[^.]+$/, "");
  const ext = format === "png" ? "png" : "jpg";
  const type = format === "png" ? "image/png" : "image/jpeg";

  if (total === 1) {
    const canvas = await renderPage(await doc.getPage(1), dpi);
    const blob = await canvasToBlob(canvas, type, 0.92);
    await doc.destroy();
    return { blob, name: `${base}.${ext}`, info: { pages: 1 } };
  }
  const zip = new JSZip();
  for (let p = 1; p <= total; p += 1) {
    const page = await doc.getPage(p);
    const canvas = await renderPage(page, dpi);
    const blob = await canvasToBlob(canvas, type, 0.92);
    zip.file(`${base}-${p}.${ext}`, blob);
    page.cleanup();
    onProgress(Math.round((p / total) * 100));
  }
  await doc.destroy();
  return {
    blob: await zip.generateAsync({ type: "blob", compression: "DEFLATE" }),
    name: `${base}-${ext === "jpg" ? "images" : "png"}.zip`,
    info: { pages: total },
  };
}

/** Utility used by other engines: build a PDF from rendered canvases. */
export async function canvasesToPdf(canvases, { quality = 0.92 } = {}) {
  const doc = await PDFDocument.create();
  for (const canvas of canvases) {
    const blob = await canvasToBlob(canvas, "image/jpeg", quality);
    const image = await doc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    const page = doc.addPage([canvas.width * 0.75, canvas.height * 0.75]);
    page.drawImage(image, { x: 0, y: 0, width: canvas.width * 0.75, height: canvas.height * 0.75 });
  }
  return new Blob([await doc.save()], { type: "application/pdf" });
}

export { PDFDocument, JSZip };
