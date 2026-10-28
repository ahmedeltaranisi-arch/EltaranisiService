// Exports scanned pages to PDF or images (JPEG/PNG), after crop + filter.
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import { applyFilter } from "./filters.js";
import { warpPerspective, cropRect, quadToRect, isRectangular, rectToQuad } from "./perspective.js";

const MAX_SIDE = 2600;

/** Produces the final canvas for one page (crop/perspective + filter). */
export function renderPageCanvas(page, { maxSize = MAX_SIDE, filterOverride = null, upscale = 1, raw = false } = {}) {
  const source = page.canvas;
  const quad = page.quad.map((point) => ({ x: point.x * source.width, y: point.y * source.height }));
  const target = Math.round(maxSize * upscale);
  let cropped;
  if (isRectangular(quad) || page.perspective === false) {
    cropped = cropRect(source, quadToRect(quad), { maxSize: target });
  } else {
    cropped = warpPerspective(source, quad, { maxSize: target });
  }
  // geometry only (used when baking a confirmed crop, so filters are not applied twice)
  if (raw) return cropped;
  const ctx = cropped.getContext("2d", { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, cropped.width, cropped.height);
  applyFilter(imageData, filterOverride || page.filter);
  applyAdjust(imageData, page.adjust);
  ctx.putImageData(imageData, 0, 0);
  return cropped;
}

/** Brightness / contrast touch-up applied after the scan filter. */
export function applyAdjust(imageData, adjust) {
  if (!adjust) return imageData;
  const brightness = Number(adjust.brightness) || 0; // -60 … +60
  const contrast = Number(adjust.contrast) || 0; // -50 … +50
  if (!brightness && !contrast) return imageData;
  const factor = (259 * (contrast * 2.55 + 255)) / (255 * (259 - contrast * 2.55));
  const { data } = imageData;
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c += 1) {
      let value = data[i + c] + brightness;
      value = factor * (value - 128) + 128;
      data[i + c] = value < 0 ? 0 : value > 255 ? 255 : value;
    }
  }
  return imageData;
}

function toBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("تعذر تصدير الصفحة"))), type, quality);
  });
}

/** Builds a PDF where each scanned page is one page sized to its pixels. */
export async function buildScanPdf(pages, { quality = 0.88, onProgress = () => {} } = {}) {
  const doc = await PDFDocument.create();
  doc.setCreator("Eltaranisi Service+ — Scan");
  doc.setProducer("Eltaranisi Service+");
  for (let index = 0; index < pages.length; index += 1) {
    const canvas = renderPageCanvas(pages[index]);
    const blob = await toBlob(canvas, "image/jpeg", quality);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const image = await doc.embedJpg(bytes);
    const widthPt = canvas.width * 0.75;
    const heightPt = canvas.height * 0.75;
    const page = doc.addPage([widthPt, heightPt]);
    page.drawImage(image, { x: 0, y: 0, width: widthPt, height: heightPt });
    onProgress(Math.round(((index + 1) / pages.length) * 95));
  }
  const bytes = await doc.save({ useObjectStreams: true });
  return new Blob([bytes], { type: "application/pdf" });
}

/** Builds the individual page images (one blob per page, no ZIP). */
export async function buildScanImageFiles(pages, { format = "jpg", quality = 0.9, onProgress = () => {} } = {}) {
  const type = format === "png" ? "image/png" : "image/jpeg";
  const files = [];
  for (let index = 0; index < pages.length; index += 1) {
    const canvas = renderPageCanvas(pages[index]);
    const blob = await toBlob(canvas, type, quality);
    const number = String(index + 1).padStart(2, "0");
    files.push({
      name: `scan-${number}.${format === "png" ? "png" : "jpg"}`,
      blob,
      width: canvas.width,
      height: canvas.height,
    });
    onProgress(Math.round(((index + 1) / pages.length) * 95));
  }
  return files;
}

/** Builds a ZIP of JPG/PNG pages. */
export async function buildScanImages(pages, { format = "jpg", quality = 0.9, onProgress = () => {} } = {}) {
  const zip = new JSZip();
  const type = format === "png" ? "image/png" : "image/jpeg";
  for (let index = 0; index < pages.length; index += 1) {
    const canvas = renderPageCanvas(pages[index]);
    const blob = await toBlob(canvas, type, quality);
    zip.file(`scan-${String(index + 1).padStart(2, "0")}.${format === "png" ? "png" : "jpg"}`, blob);
    onProgress(Math.round(((index + 1) / pages.length) * 95));
  }
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  return blob;
}

export { quadToRect, rectToQuad };
