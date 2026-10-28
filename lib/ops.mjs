import JSZip from "jszip";
import {
  mergePdfs, splitPdf, organizePdf, rotatePdf, addPageNumbers, watermarkPdf, cleanPdf,
  imagesToPdf, rasterizePdfToPdf, parsePageRanges, loadPdf,
} from "./pdf-core.mjs";
import { extractPdfStructure, extractPdfGrid, renderPdfPages, pdfHasTextLayer } from "./pdf-render.mjs";
import { htmlToPdf, wrapHtml } from "./browser.mjs";
import {
  docxToHtml, workbookToHtml, spreadsheetCss, pptxToHtml, buildDocx, buildXlsx, buildTxt,
  csvToXlsx, xlsxToCsv, csvToHtml,
} from "./office.mjs";
import PptxGenJS from "pptxgenjs";

const MAX_PDF_PAGES_FOR_OFFICE = 80;

function baseName(name = "file") {
  return String(name).replace(/\.[^.]+$/, "") || "file";
}

function extOf(name = "") {
  return String(name).toLowerCase().split(".").pop();
}

function pdfWrap(html, { rtl, title = "", extraCss = "", landscape = false, margin = "14mm", pageSize = "A4" } = {}) {
  return wrapHtml({
    title: title || "document",
    landscape,
    pageSize,
    margin,
    body: `<div class="${rtl ? "rtl" : "ltr"}">${html}</div>`,
    css: `
      ${extraCss}
      body { padding: 6mm 4mm; }
      .rtl { direction: rtl; text-align: right; }
      .ltr { direction: ltr; text-align: left; }
      .rtl table, .rtl th, .rtl td { text-align: right; }
      h1 { font-size: 20pt; margin: 0 0 12pt; }
      h2 { font-size: 15pt; margin: 14pt 0 8pt; }
      h3 { font-size: 13pt; margin: 12pt 0 6pt; }
      p { margin: 0 0 8pt; }
      img { max-width: 100%; height: auto; }
      .doc-title { font-size: 24pt; text-align: center; margin-bottom: 16pt; }
    `,
  });
}

export async function toPdfFromAny(files, options = {}) {
  const file = files[0];
  if (!file) throw new Error("لم يتم إرفاق ملف / No file provided");
  const ext = extOf(file.name);
  if (ext === "pdf") return { files: [{ name: `${baseName(file.name)}.pdf`, data: await cleanPdf(file.data) }] };

  if (["docx", "doc", "odt", "rtf"].includes(ext)) {
    if (ext !== "docx") throw new Error("الصيغ القديمة (.doc) غير مدعومة حالياً، يرجى التحويل إلى .docx أولاً");
    const { html, rtl } = await docxToHtml(file.data);
    const pdf = await htmlToPdf(pdfWrap(html, { rtl, landscape: Boolean(options.landscape), margin: options.margin || "18mm" }), {
      pageSize: options.pageSize || "A4", landscape: Boolean(options.landscape),
    });
    return { files: [{ name: `${baseName(file.name)}.pdf`, data: pdf }] };
  }

  if (["xlsx", "xls", "csv", "ods"].includes(ext)) {
    if (ext === "csv") {
      const { html, rtl } = csvToHtml(file.data);
      const pdf = await htmlToPdf(pdfWrap(html, { rtl, extraCss: spreadsheetCss, landscape: true, margin: "12mm" }), { pageSize: "A4", landscape: true });
      return { files: [{ name: `${baseName(file.name)}.pdf`, data: pdf }] };
    }
    const { html, rtl } = workbookToHtml(file.data);
    const wide = true;
    const pdf = await htmlToPdf(pdfWrap(html, { rtl, extraCss: spreadsheetCss, landscape: wide, margin: "12mm" }), { pageSize: "A4", landscape: wide });
    return { files: [{ name: `${baseName(file.name)}.pdf`, data: pdf }] };
  }

  if (["pptx", "ppt"].includes(ext)) {
    if (ext !== "pptx") throw new Error("صيغة .ppt القديمة غير مدعومة، يرجى الحفظ بصيغة .pptx");
    const { html, css, slideWidth, slideHeight } = await pptxToHtml(file.data);
    const pdf = await htmlToPdf(wrapHtml({
      body: html,
      css,
      pageSize: `${slideWidth}in ${slideHeight}in`,
      margin: "0",
    }), { width: `${slideWidth}in`, height: `${slideHeight}in` });
    return { files: [{ name: `${baseName(file.name)}.pdf`, data: pdf }] };
  }

  if (["txt", "text", "log", "md", "markdown"].includes(ext)) {
    const text = file.data.toString("utf8");
    const rtl = /[\u0600-\u06FF]/.test(text);
    const paragraphs = text.split(/\r?\n{1,}/).map((line) => {
      const safe = line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return safe.trim() === "" ? "<p>&nbsp;</p>" : `<p>${safe}</p>`;
    }).join("");
    const pdf = await htmlToPdf(pdfWrap(paragraphs, { rtl, margin: "20mm" }), { pageSize: options.pageSize || "A4" });
    return { files: [{ name: `${baseName(file.name)}.pdf`, data: pdf }] };
  }

  if (["html", "htm"].includes(ext)) {
    const raw = file.data.toString("utf8");
    const pdf = await htmlToPdf(raw || wrapHtml({ body: "<p>empty</p>" }), { pageSize: options.pageSize || "A4" });
    return { files: [{ name: `${baseName(file.name)}.pdf`, data: pdf }] };
  }

  if (["jpg", "jpeg", "png", "webp", "gif", "bmp", "svg", "avif"].includes(ext)) {
    const pdf = await imagesToPdf([file], {
      pageSize: options.pageSize || "fit",
      orientation: options.orientation || "portrait",
      margin: Number(options.margin ?? 0),
    });
    return { files: [{ name: `${baseName(file.name)}.pdf`, data: pdf }] };
  }

  throw new Error(`صيغة غير مدعومة للتحويل إلى PDF: .${ext}`);
}

async function zipFiles(files, zipName = "result.zip") {
  const zip = new JSZip();
  const used = new Set();
  for (const file of files) {
    let name = file.name;
    let i = 2;
    while (used.has(name)) {
      name = file.name.replace(/(\.[^.]+)$/, `-${i}$1`);
      i += 1;
    }
    used.add(name);
    zip.file(name, file.data);
  }
  const data = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return { files: [{ name: zipName, data }] };
}

const pdfToImages = async (files, options, format) => {
  const file = files[0];
  const dpi = Math.min(300, Math.max(72, Number(options.dpi) || 150));
  const rendered = await renderPdfPages(file.data, { dpi, format: format === "png" ? "png" : "jpeg", quality: 0.9 });
  const outputs = rendered.map((page) => ({
    name: `${baseName(file.name)}-${page.page}.${format === "png" ? "png" : "jpg"}`,
    data: page.data,
  }));
  if (outputs.length === 1) return { files: outputs };
  return zipFiles(outputs, `${baseName(file.name)}-images.zip`);
};

const pdfToDocx = async (files) => {
  const file = files[0];
  const pages = await extractPdfStructure(file.data);
  const anyText = pages.some((page) => page.lines.length);
  if (!anyText) {
    throw new Error("هذا الملف يبدو صورة ممسوحة (Scanned) بدون طبقة نص. حوّله أولاً إلى JPG/PNG أو استخدم أداة OCR عند إضافتها.");
  }
  const rtl = pages.some((page) => page.lines.some((line) => line.rtl));
  const docx = await buildDocx(pages, { title: baseName(file.name), rtl });
  return { files: [{ name: `${baseName(file.name)}.docx`, data: docx }], info: { pages: pages.length } };
};

const pdfToXlsx = async (files) => {
  const file = files[0];
  const sheets = await extractPdfGrid(file.data, { maxPages: MAX_PDF_PAGES_FOR_OFFICE });
  const nonEmpty = sheets.filter((sheet) => sheet.rows.some((row) => row.some((cell) => String(cell).trim() !== "")));
  if (!nonEmpty.length) throw new Error("لم يتم العثور على نص قابل للاستخراج في هذا الملف");
  const xlsx = await buildXlsx(nonEmpty);
  return { files: [{ name: `${baseName(file.name)}.xlsx`, data: xlsx }], info: { pages: nonEmpty.length } };
};

const pdfToPptx = async (files, options) => {
  const file = files[0];
  const dpi = Math.min(220, Math.max(96, Number(options.dpi) || 150));
  const rendered = await renderPdfPages(file.data, { dpi, format: "png", maxPages: 60 });
  const pptx = new PptxGenJS();
  const first = rendered[0];
  const widthIn = Math.max(4, Math.min(13.333, first.widthPt / 72));
  const heightIn = Math.max(3, Math.min(7.5, first.heightPt / 72));
  pptx.defineLayout({ name: "PAGESIZE", width: widthIn, height: heightIn });
  pptx.layout = "PAGESIZE";
  for (const page of rendered) {
    const slide = pptx.addSlide();
    slide.addImage({ data: `data:image/png;base64,${page.data.toString("base64")}`, x: 0, y: 0, w: widthIn, h: heightIn });
  }
  const data = await pptx.write({ outputType: "nodebuffer" });
  return { files: [{ name: `${baseName(file.name)}.pptx`, data: Buffer.from(data) }], info: { slides: rendered.length } };
};

export const OPS = {
  "pdf:merge": async (files) => {
    if (files.length < 2) throw new Error("أضف ملفين PDF على الأقل للدمج");
    const data = await mergePdfs(files.map((f) => f.data));
    return { files: [{ name: "merged.pdf", data }] };
  },

  "pdf:split": async (files, options) => {
    const file = files[0];
    const results = await splitPdf(file.data, options.mode || "ranges", options.ranges);
    if (results.length === 1) return { files: [{ name: `${baseName(file.name)}-${results[0].name}`, data: results[0].data }] };
    return zipFiles(results.map((r) => ({ name: r.name, data: r.data })), `${baseName(file.name)}-split.zip`);
  },

  "pdf:organize": async (files, options) => {
    const file = files[0];
    const data = await organizePdf(file.data, options.order);
    return { files: [{ name: `${baseName(file.name)}-organized.pdf`, data }] };
  },

  "pdf:rotate": async (files, options) => {
    const file = files[0];
    const data = await rotatePdf(file.data, Number(options.angle) || 90, options.pages || "");
    return { files: [{ name: `${baseName(file.name)}-rotated.pdf`, data }] };
  },

  "pdf:compress": async (files, options) => {
    const file = files[0];
    const level = options.level || "medium";
    const before = file.data.length;
    let data;
    if (level === "light") data = await cleanPdf(file.data);
    else if (level === "strong") data = await rasterizePdfToPdf(file.data, { dpi: 110, quality: 0.6 });
    else data = await rasterizePdfToPdf(file.data, { dpi: 150, quality: 0.75 });
    let final = data;
    if (final.length >= before && level !== "light") {
      final = await cleanPdf(file.data);
    }
    const after = final.length;
    return {
      files: [{ name: `${baseName(file.name)}-compressed.pdf`, data: final }],
      info: {
        before, after,
        saved: Math.max(0, before - after),
        savedPercent: before ? Math.round(((before - after) / before) * 100) : 0,
      },
    };
  },

  "pdf:numbers": async (files, options) => {
    const file = files[0];
    const data = await addPageNumbers(file.data, {
      position: options.position || "bottom-center",
      format: options.format || "{n} / {total}",
      startAt: Number(options.startAt) || 1,
      fontSize: Number(options.fontSize) || 10,
      skipFirst: Boolean(options.skipFirst),
    });
    return { files: [{ name: `${baseName(file.name)}-numbered.pdf`, data }] };
  },

  "pdf:watermark": async (files, options) => {
    const file = files[0];
    const data = await watermarkPdf(file.data, {
      text: options.text || "Eltaranisi Service+",
      opacity: Number(options.opacity) || 0.14,
      fontSize: Number(options.fontSize) || 52,
      layout: options.layout || "diagonal",
    });
    return { files: [{ name: `${baseName(file.name)}-watermark.pdf`, data }] };
  },

  "pdf:to-jpg": (files, options) => pdfToImages(files, options, "jpg"),
  "pdf:to-png": (files, options) => pdfToImages(files, options, "png"),
  "pdf:to-docx": (files) => pdfToDocx(files),
  "pdf:to-xlsx": (files) => pdfToXlsx(files),
  "pdf:to-pptx": (files, options) => pdfToPptx(files, options),
  "pdf:to-txt": async (files) => {
    const file = files[0];
    const pages = await extractPdfStructure(file.data);
    const hasText = pages.some((p) => p.lines.length);
    if (!hasText) throw new Error("لا توجد طبقة نص في هذا الملف (PDF ممسوح ضوئياً)");
    return { files: [{ name: `${baseName(file.name)}.txt`, data: buildTxt(pages) }] };
  },
  "pdf:has-text": async (files) => {
    const has = await pdfHasTextLayer(files[0].data);
    return { info: { hasText: has } };
  },

  "img:to-pdf": async (files, options) => {
    const data = await imagesToPdf(files, {
      pageSize: options.pageSize || "fit",
      orientation: options.orientation || "portrait",
      margin: Number(options.margin ?? 0),
    });
    return { files: [{ name: files.length === 1 ? `${baseName(files[0].name)}.pdf` : "images.pdf", data }] };
  },

  "img:convert": async (files, options) => {
    const { normalizeImage } = await import("./pdf-core.mjs");
    const target = options.target === "png" ? "png" : "jpg";
    const outputs = [];
    for (const file of files) {
      const data = await normalizeImage(file.name, file.data, target, Number(options.quality) || 0.92);
      outputs.push({ name: `${baseName(file.name)}.${target}`, data });
    }
    if (outputs.length === 1) return { files: outputs };
    return zipFiles(outputs, "images.zip");
  },

  "to-pdf": (files, options) => toPdfFromAny(files, options),
  "docx:to-pdf": (files, options) => toPdfFromAny(files, options),
  "xlsx:to-pdf": (files, options) => toPdfFromAny(files, options),
  "pptx:to-pdf": (files, options) => toPdfFromAny(files, options),
  "docx:to-txt": async (files) => {
    const { text } = await docxToHtml(files[0].data);
    return { files: [{ name: `${baseName(files[0].name)}.txt`, data: Buffer.from(text, "utf8") }] };
  },
  "xlsx:to-csv": async (files) => ({
    files: [{ name: `${baseName(files[0].name)}.csv`, data: xlsxToCsv(files[0].data) }],
  }),
  "csv:to-xlsx": async (files) => ({
    files: [{ name: `${baseName(files[0].name)}.xlsx`, data: await csvToXlsx(files[0].data) }],
  }),
  "pptx:to-jpg": async (files, options) => {
    const { html, css, slideWidth, slideHeight } = await pptxToHtml(files[0].data);
    const pdf = await htmlToPdf(wrapHtml({ body: html, css, pageSize: `${slideWidth}in ${slideHeight}in`, margin: "0" }), { width: `${slideWidth}in`, height: `${slideHeight}in` });
    const rendered = await renderPdfPages(pdf, { dpi: Math.min(220, Math.max(96, Number(options.dpi) || 130)), format: "jpeg", quality: 0.92 });
    const outputs = rendered.map((page) => ({ name: `${baseName(files[0].name)}-${page.page}.jpg`, data: page.data }));
    if (outputs.length === 1) return { files: outputs };
    return zipFiles(outputs, `${baseName(files[0].name)}-slides.zip`);
  },
  "pdf:info": async (files) => {
    const doc = await loadPdf(files[0].data);
    return { info: { pages: doc.getPageCount(), size: files[0].data.length } };
  },
};

export async function runOperation(op, files, options = {}) {
  const handler = OPS[op];
  if (!handler) throw new Error(`عملية غير معروفة: ${op}`);
  const result = await handler(files, options);
  return result;
}
