// In-browser extraction/Office export (PDF -> DOCX / XLSX / PPTX / TXT).
import { Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel } from "docx";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { openDocument, readItems, renderPage } from "./pdfjs.js";
import { structuredLines, tableRows, mergeWrappedLines } from "../../lib/text-assembly.mjs";

const hasArabic = (text = "") => /[\u0600-\u06FF]/.test(String(text));

async function pageStructures(file, onProgress = () => {}, maxPages = 400) {
  const doc = await openDocument(new Uint8Array(await file.arrayBuffer()));
  const total = Math.min(doc.numPages, maxPages);
  const pages = [];
  for (let p = 1; p <= total; p += 1) {
    const { page, items } = await readItems(doc, p);
    pages.push({ page: p, lines: structuredLines(items) });
    page.cleanup();
    onProgress(Math.round((p / total) * 85));
  }
  await doc.destroy();
  return pages;
}

const baseName = (name) => String(name).replace(/\.[^.]+$/, "");

export async function toTxt(file, options, onProgress) {
  const pages = await pageStructures(file, onProgress);
  const text = pages.map((page) => page.lines.map((line) => line.text).join("\n")).join("\n\n---\n\n");
  if (!text.trim()) {
    throw new Error("لا توجد طبقة نص في هذا الملف (PDF ممسوح ضوئياً بدون OCR)");
  }
  onProgress(100);
  return {
    blob: new Blob([text], { type: "text/plain;charset=utf-8" }),
    name: `${baseName(file.name)}.txt`,
    info: { pages: pages.length },
  };
}

export async function toDocx(file, options, onProgress) {
  const pages = await pageStructures(file, onProgress);
  const allLines = pages.flatMap((page) => page.lines);
  if (!allLines.length) {
    throw new Error("هذا الملف يبدو صورة ممسوحة بدون طبقة نص. استخدم أداة PDF ← JPG أو أضف OCR.");
  }
  const rtl = allLines.some((line) => line.rtl || hasArabic(line.text));
  const sizes = allLines.map((line) => line.size).sort((a, b) => a - b);
  const median = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 11;

  const children = [];
  pages.forEach((page, pageIndex) => {
    const lines = mergeWrappedLines(page.lines);
    for (const line of lines) {
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
    if (pageIndex < pages.length - 1) {
      children.push(new Paragraph({ text: "", pageBreakBefore: true }));
    }
    onProgress(85 + Math.round(((pageIndex + 1) / pages.length) * 10));
  });

  const doc = new Document({
    creator: "Eltaranisi Service+",
    styles: { default: { document: { run: { font: "Arial", size: 22 } } } },
    sections: [{ children }],
  });
  const blob = await Packer.toBlob(doc);
  onProgress(100);
  return {
    blob,
    name: `${baseName(file.name)}.docx`,
    info: { pages: pages.length },
  };
}

export async function toXlsx(file, options, onProgress) {
  const doc = await openDocument(new Uint8Array(await file.arrayBuffer()));
  const total = Math.min(doc.numPages, 60);
  const workbook = XLSX.utils.book_new();
  let sheets = 0;
  for (let p = 1; p <= total; p += 1) {
    const { page, items } = await readItems(doc, p);
    const rows = tableRows(items);
    let arabicCells = 0;
    let totalCells = 0;
    rows.forEach((row) => row.forEach((cell) => {
      totalCells += 1;
      if (hasArabic(cell)) arabicCells += 1;
    }));
    const rtlPage = totalCells > 0 && arabicCells / totalCells > 0.2;
    const finalRows = rows.map((row) => (rtlPage ? [...row].reverse() : row));
    const filled = finalRows.filter((row) => row.some((cell) => String(cell).trim() !== ""));
    if (filled.length) {
      const sheet = XLSX.utils.aoa_to_sheet(filled);
      const maxCols = Math.max(...filled.map((row) => row.length));
      sheet["!cols"] = Array.from({ length: maxCols }, () => ({ wch: 24 }));
      XLSX.utils.book_append_sheet(workbook, sheet, `Page ${p}`);
      sheets += 1;
    }
    page.cleanup();
    onProgress(Math.round((p / total) * 90));
  }
  await doc.destroy();
  if (!sheets) throw new Error("لم يتم العثور على نص قابل للاستخراج في هذا الملف");
  const buffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  onProgress(100);
  return {
    blob: new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    name: `${baseName(file.name)}.xlsx`,
    info: { pages: sheets },
  };
}

export async function toPptx(file, options, onProgress) {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const dpi = Math.min(220, Math.max(96, Number(options.dpi) || 150));
  const doc = await openDocument(new Uint8Array(await file.arrayBuffer()));
  const total = Math.min(doc.numPages, 60);
  const first = await doc.getPage(1);
  const baseView = first.getViewport({ scale: 1 });
  first.cleanup();

  const pptx = new PptxGenJS();
  const widthIn = Math.max(4, Math.min(13.333, baseView.width / 72));
  const heightIn = Math.max(3, Math.min(7.5, baseView.height / 72));
  pptx.defineLayout({ name: "PAGESIZE", width: widthIn, height: heightIn });
  pptx.layout = "PAGESIZE";

  for (let p = 1; p <= total; p += 1) {
    const page = await doc.getPage(p);
    const canvas = await renderPage(page, dpi);
    const dataUrl = canvas.toDataURL("image/png");
    const slide = pptx.addSlide();
    slide.addImage({ data: dataUrl, x: 0, y: 0, w: widthIn, h: heightIn });
    page.cleanup();
    onProgress(Math.round((p / total) * 90));
  }
  await doc.destroy();
  const blob = await pptx.write({ outputType: "blob" });
  onProgress(100);
  return {
    blob,
    name: `${baseName(file.name)}.pptx`,
    info: { slides: total },
  };
}

/** PDF page images -> JPG (used by the PowerPoint/PDF preview helpers). */
export async function pdfPagesToBlobs(file, dpi = 150) {
  const doc = await openDocument(new Uint8Array(await file.arrayBuffer()));
  const out = [];
  for (let p = 1; p <= doc.numPages; p += 1) {
    const page = await doc.getPage(p);
    const canvas = await renderPage(page, dpi);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    out.push(blob);
    page.cleanup();
  }
  await doc.destroy();
  return out;
}

export { JSZip };
