// pdf.js setup for the browser engine (worker served by Vite as a static asset).
import * as pdfjs from "pdfjs-dist/build/pdf.mjs";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const OPTIONS = {
  isEvalSupported: false,
  useSystemFonts: false,
  disableFontFace: true,
  verbosity: 0,
};

export async function openDocument(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return pdfjs.getDocument({ ...OPTIONS, data }).promise;
}

export async function readItems(doc, pageNumber) {
  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent();
  return { page, items: content.items };
}

export async function renderPage(page, dpi = 150) {
  const scale = dpi / 72;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  return canvas;
}

export function canvasToBlob(canvas, type = "image/jpeg", quality = 0.9) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("canvas export failed"))), type, quality);
  });
}

export { pdfjs };
