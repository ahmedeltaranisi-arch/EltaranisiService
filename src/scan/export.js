// Exports scanned pages to PDF or images (JPEG/PNG), after crop + filter.
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import { applyFilter } from "./filters.js";
import { warpPerspective, cropRect, quadToRect, isRectangular, rectToQuad } from "./perspective.js";

const MAX_SIDE = 2600;

/** Produces the final canvas for one page (crop/perspective + filter). */
export function renderPageCanvas(page, { maxSize = MAX_SIDE, filterOverride = null } = {}) {
  const source = page.canvas;
  const quad = page.quad.map((point) => ({ x: point.x * source.width, y: point.y * source.height }));
  let cropped;
  if (isRectangular(quad) || page.perspective === false) {
    cropped = cropRect(source, quadToRect(quad), { maxSize });
  } else {
    cropped = warpPerspective(source, quad, { maxSize });
  }
  const ctx = cropped.getContext("2d", { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, cropped.width, cropped.height);
  applyFilter(imageData, filterOverride || page.filter);
  ctx.putImageData(imageData, 0, 0);
  return cropped;
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
