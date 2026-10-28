// Router for the in-browser engine.
// Everything that does not need Chromium runs locally: no upload, no 4.5 MB limit.
import * as pdfOps from "./pdfops.js";
import * as imageOps from "./images.js";
import * as officeOut from "./office-out.js";

/** Operations fully handled in the browser. */
export const LOCAL_OPS = new Set([
  "pdf:merge", "pdf:split", "pdf:organize", "pdf:rotate", "pdf:compress",
  "pdf:watermark", "pdf:numbers", "pdf:to-jpg", "pdf:to-png", "pdf:to-txt",
  "pdf:to-docx", "pdf:to-xlsx", "pdf:to-pptx",
  "img:to-pdf", "img:convert",
]);

/** Operations that must run on the server (they need a real browser engine). */
export const SERVER_OPS = new Set([
  "to-pdf", "docx:to-pdf", "xlsx:to-pdf", "pptx:to-pdf",
  "docx:to-txt", "xlsx:to-csv", "csv:to-xlsx", "pptx:to-jpg",
]);

/** Vercel rejects request bodies above 4.5 MB before the function runs. */
export const SERVER_LIMIT_BYTES = 4.4 * 1024 * 1024;

export function canRunLocally(op) {
  return LOCAL_OPS.has(op);
}

/**
 * Runs an operation in the browser.
 * @returns {Promise<{blob: Blob, name: string, info: object, engine: string}>}
 */
export async function runLocally(op, files, options = {}, onProgress = () => {}) {
  const file = files[0];
  const step = (value, label) => onProgress(Math.min(99, Math.max(0, Math.round(value))), label);
  step(5, "تهيئة المحرك");

  let result;
  switch (op) {
    case "pdf:merge":
      result = await pdfOps.merge(files);
      break;
    case "pdf:split":
      result = await pdfOps.split(file, options);
      break;
    case "pdf:organize":
      result = await pdfOps.organize(file, options.order);
      break;
    case "pdf:rotate":
      result = await pdfOps.rotate(file, options);
      break;
    case "pdf:compress":
      result = await pdfOps.compress(file, options, (p) => step(p, "جارٍ ضغط الصفحات"));
      break;
    case "pdf:watermark":
      result = await pdfOps.watermark(file, options);
      break;
    case "pdf:numbers":
      result = await pdfOps.pageNumbers(file, options);
      break;
    case "pdf:to-jpg":
      result = await pdfOps.toImages(file, options, "jpg", (p) => step(p, "جارٍ تحويل الصفحات"));
      break;
    case "pdf:to-png":
      result = await pdfOps.toImages(file, options, "png", (p) => step(p, "جارٍ تحويل الصفحات"));
      break;
    case "pdf:to-txt":
      result = await officeOut.toTxt(file, options, (p) => step(p, "جارٍ استخراج النص"));
      break;
    case "pdf:to-docx":
      result = await officeOut.toDocx(file, options, (p) => step(p, "جارٍ بناء Word"));
      break;
    case "pdf:to-xlsx":
      result = await officeOut.toXlsx(file, options, (p) => step(p, "جارٍ بناء Excel"));
      break;
    case "pdf:to-pptx":
      result = await officeOut.toPptx(file, options, (p) => step(p, "جارٍ بناء العرض"));
      break;
    case "img:to-pdf":
      result = await imageOps.imagesToPdf(files, options, (p) => step(p, "جارٍ تجهيز الصور"));
      break;
    case "img:convert":
      result = await imageOps.convertImages(files, options, (p) => step(p, "جارٍ تحويل الصور"));
      break;
    default:
      throw new Error(`هذه العملية تحتاج الخادم: ${op}`);
  }

  step(100, "تم");
  return { ...result, engine: "browser" };
}
