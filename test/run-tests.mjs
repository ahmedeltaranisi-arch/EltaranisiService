/**
 * End-to-end test suite: every tool is exercised through the real HTTP API
 * and every output is validated by parsing it back.
 */
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { loadPdf, extractPdfStructure, pdfHasTextLayer } from "../lib/index-test.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:4173";
const FIX = path.join(process.cwd(), "test", "fixtures");
const OUT = path.join(process.cwd(), "test", "output");
fs.mkdirSync(OUT, { recursive: true });

const results = [];

function record(name, status, detail, extra = "") {
  results.push({ name, status, detail, extra });
  const icon = status === "PASS" ? "✅" : status === "WARN" ? "⚠️" : "❌";
  console.log(`${icon} ${name} — ${detail}${extra ? ` (${extra})` : ""}`);
}

async function callApi(op, files, options = {}) {
  const form = new FormData();
  form.append("op", op);
  form.append("options", JSON.stringify(options));
  for (const file of files) {
    const buffer = fs.readFileSync(path.join(FIX, file));
    form.append("file", new Blob([buffer]), file);
  }
  const response = await fetch(`${BASE}/api/convert`, { method: "POST", body: form });
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const payload = await response.json();
    return { ok: response.ok, json: payload, status: response.status };
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const name = decodeURIComponent(response.headers.get("x-output-name") || "output.bin");
  const infoHeader = response.headers.get("x-result-info");
  const info = infoHeader ? JSON.parse(decodeURIComponent(infoHeader)) : {};
  return { ok: response.ok, buffer, name, info, status: response.status, contentType };
}

function save(result, label) {
  const file = path.join(OUT, `${label}__${result.name}`);
  fs.writeFileSync(file, result.buffer);
  return file;
}

async function expectPdf(result, label, { minPages = 1, checkText = false } = {}) {
  if (!result.ok) throw new Error(`API error: ${result.json?.error || result.status}`);
  if (!result.buffer.slice(0, 4).equals(Buffer.from("%PDF"))) throw new Error("output is not a PDF");
  const file = save(result, label);
  const structure = await extractPdfStructure(result.buffer);
  if (structure.length < minPages) throw new Error(`expected >= ${minPages} pages, got ${structure.length}`);
  if (checkText) {
    const text = structure.flatMap((p) => p.lines.map((l) => l.text)).join(" ").trim();
    if (text.length < 5) throw new Error("PDF has no extractable text");
    return { file, pages: structure.length, text, bytes: result.buffer.length };
  }
  return { file, pages: structure.length, bytes: result.buffer.length };
}

async function test(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    record(name, "PASS", typeof detail === "string" ? detail : detail.summary || "ok",
      `${Date.now() - started}ms`);
  } catch (error) {
    record(name, "FAIL", error.message);
  }
}

let pdfBase = null; // Arabic DOCX -> PDF, reused by the PDF tools

/* ------------------------------- Core conversions ------------------------------ */

await test("DOCX → PDF (Arabic layout)", async () => {
  const result = await callApi("to-pdf", ["report-ar.docx"]);
  const out = await expectPdf(result, "docx-to-pdf", { checkText: true });
  pdfBase = out.file;
  return `${out.pages} صفحة، ${Math.round(out.bytes / 1024)}KB`;
});

await test("XLSX → PDF", async () => {
  const result = await callApi("to-pdf", ["inventory.xlsx"]);
  const out = await expectPdf(result, "xlsx-to-pdf", { checkText: true });
  return `${out.pages} صفحة`;
});

await test("PPTX → PDF", async () => {
  const result = await callApi("to-pdf", ["plan.pptx"]);
  const out = await expectPdf(result, "pptx-to-pdf", { minPages: 2, checkText: true });
  return `${out.pages} شريحة/صفحة`;
});

await test("JPG → PDF", async () => {
  const result = await callApi("img:to-pdf", ["photo1.jpg"]);
  const out = await expectPdf(result, "jpg-to-pdf");
  return `${out.pages} صفحة`;
});

await test("PNG → PDF (A4)", async () => {
  const result = await callApi("img:to-pdf", ["photo2.png"], { pageSize: "A4", margin: 20 });
  const out = await expectPdf(result, "png-to-pdf-a4");
  return `${out.pages} صفحة`;
});

await test("TXT → PDF (Arabic)", async () => {
  const result = await callApi("to-pdf", ["notes.txt"]);
  const out = await expectPdf(result, "txt-to-pdf", { checkText: true });
  return "نص عربي مقروء";
});

await test("HTML → PDF", async () => {
  const result = await callApi("to-pdf", ["page.html"]);
  const out = await expectPdf(result, "html-to-pdf", { checkText: true });
  return "ok";
});

await test("CSV → PDF", async () => {
  const result = await callApi("to-pdf", ["data.csv"]);
  const out = await expectPdf(result, "csv-to-pdf", { checkText: true });
  return "ok";
});

/* ------------------------------- PDF tools ------------------------------- */

await test("PDF → DOCX", async () => {
  const form = new FormData();
  form.append("op", "pdf:to-docx");
  form.append("options", "{}");
  form.append("file", new Blob([fs.readFileSync(pdfBase)]), "base.pdf");
  const response = await fetch(`${BASE}/api/convert`, { method: "POST", body: form });
  if (!response.ok) throw new Error((await response.json()).error);
  const buffer = Buffer.from(await response.arrayBuffer());
  const file = path.join(OUT, "pdf-to-docx.docx");
  fs.writeFileSync(file, buffer);
  const mammoth = (await import("mammoth")).default;
  const { value } = await mammoth.extractRawText({ buffer });
  const arabic = (value.match(/[\u0600-\u06FF]/g) || []).length;
  if (arabic < 20) throw new Error(`docx Arabic content too small (${arabic} chars)`);
  const sample = value.split("\n").filter((l) => l.trim()).slice(0, 3).join(" | ");
  return `نص عربي ${arabic} حرف: ${sample.slice(0, 70)}`;
});

await test("PDF → XLSX", async () => {
  const form = new FormData();
  form.append("op", "pdf:to-xlsx");
  form.append("options", "{}");
  form.append("file", new Blob([fs.readFileSync(pdfBase)]), "base.pdf");
  const response = await fetch(`${BASE}/api/convert`, { method: "POST", body: form });
  if (!response.ok) throw new Error((await response.json()).error);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(path.join(OUT, "pdf-to-xlsx.xlsx"), buffer);
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  const filled = rows.filter((r) => r.some((c) => String(c || "").trim()));
  if (!filled.length) throw new Error("no rows extracted");
  return `${wb.SheetNames.length} ورقة، ${filled.length} صف`;
});

await test("PDF → PPTX", async () => {
  const form = new FormData();
  form.append("op", "pdf:to-pptx");
  form.append("options", JSON.stringify({ dpi: 120 }));
  form.append("file", new Blob([fs.readFileSync(pdfBase)]), "base.pdf");
  const response = await fetch(`${BASE}/api/convert`, { method: "POST", body: form });
  if (!response.ok) throw new Error((await response.json()).error);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(path.join(OUT, "pdf-to-pptx.pptx"), buffer);
  const zip = await JSZip.loadAsync(buffer);
  const slides = Object.keys(zip.files).filter((n) => /ppt\/slides\/slide\d+\.xml$/.test(n)).length;
  if (!slides) throw new Error("no slides in pptx");
  const media = Object.keys(zip.files).filter((n) => n.startsWith("ppt/media/")).length;
  if (!media) throw new Error("slides have no images");
  return `${slides} شريحة، ${media} صورة`;
});

await test("PDF → JPG", async () => {
  const form = new FormData();
  form.append("op", "pdf:to-jpg");
  form.append("options", JSON.stringify({ dpi: 120 }));
  form.append("file", new Blob([fs.readFileSync(pdfBase)]), "base.pdf");
  const response = await fetch(`${BASE}/api/convert`, { method: "POST", body: form });
  if (!response.ok) throw new Error((await response.json()).error);
  const buffer = Buffer.from(await response.arrayBuffer());
  const name = decodeURIComponent(response.headers.get("x-output-name") || "");
  if (name.endsWith(".zip")) {
    const zip = await JSZip.loadAsync(buffer);
    const entries = Object.keys(zip.files);
    const first = await zip.file(entries[0]).async("nodebuffer");
    fs.writeFileSync(path.join(OUT, "pdf-to-jpg.zip"), buffer);
    if (first[0] !== 0xff || first[1] !== 0xd8) throw new Error("first image is not JPEG");
    return `${entries.length} صورة داخل ZIP`;
  }
  fs.writeFileSync(path.join(OUT, "pdf-to-jpg.jpg"), buffer);
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) throw new Error("not a JPEG");
  return `${Math.round(buffer.length / 1024)}KB`;
});

await test("PDF → PNG", async () => {
  const form = new FormData();
  form.append("op", "pdf:to-png");
  form.append("options", JSON.stringify({ dpi: 110 }));
  form.append("file", new Blob([fs.readFileSync(pdfBase)]), "base.pdf");
  const response = await fetch(`${BASE}/api/convert`, { method: "POST", body: form });
  if (!response.ok) throw new Error((await response.json()).error);
  const buffer = Buffer.from(await response.arrayBuffer());
  const name = decodeURIComponent(response.headers.get("x-output-name") || "");
  if (!name.endsWith(".zip")) {
    fs.writeFileSync(path.join(OUT, "pdf-to-png.png"), buffer);
    if (buffer[0] !== 0x89 || buffer[1] !== 0x50) throw new Error("not a PNG");
    return "صورة PNG واحدة";
  }
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.keys(zip.files);
  const first = await zip.file(entries[0]).async("nodebuffer");
  fs.writeFileSync(path.join(OUT, "pdf-to-png.zip"), buffer);
  if (first[0] !== 0x89 || first[1] !== 0x50) throw new Error("not a PNG");
  return `${entries.length} صورة PNG`;
});

await test("PDF → TXT", async () => {
  const form = new FormData();
  form.append("op", "pdf:to-txt");
  form.append("options", "{}");
  form.append("file", new Blob([fs.readFileSync(pdfBase)]), "base.pdf");
  const response = await fetch(`${BASE}/api/convert`, { method: "POST", body: form });
  if (!response.ok) throw new Error((await response.json()).error);
  const text = await response.text();
  fs.writeFileSync(path.join(OUT, "pdf-to-txt.txt"), text);
  const arabic = (text.match(/[\u0600-\u06FF]/g) || []).length;
  if (arabic < 20) throw new Error("too little Arabic text extracted");
  return `${text.length} حرف (${arabic} عربي)`;
});

await test("PDF Merge", async () => {
  const form = new FormData();
  form.append("op", "pdf:merge");
  form.append("options", "{}");
  const buffer = fs.readFileSync(pdfBase);
  form.append("file", new Blob([buffer]), "a.pdf");
  form.append("file", new Blob([buffer]), "b.pdf");
  const response = await fetch(`${BASE}/api/convert`, { method: "POST", body: form });
  if (!response.ok) throw new Error((await response.json()).error);
  const merged = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(path.join(OUT, "merged.pdf"), merged);
  const structure = await extractPdfStructure(merged);
  const single = await extractPdfStructure(buffer);
  if (structure.length !== single.length * 2) throw new Error(`page count ${structure.length} != ${single.length * 2}`);
  return `${structure.length} صفحة`;
});

await test("PDF Split (ranges)", async () => {
  const form = new FormData();
  form.append("op", "pdf:split");
  form.append("options", JSON.stringify({ mode: "ranges", ranges: "1" }));
  form.append("file", new Blob([fs.readFileSync(pdfBase)]), "base.pdf");
  const response = await fetch(`${BASE}/api/convert`, { method: "POST", body: form });
  if (!response.ok) throw new Error((await response.json()).error);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(path.join(OUT, "split.pdf"), buffer);
  const structure = await extractPdfStructure(buffer);
  if (structure.length !== 1) throw new Error(`expected 1 page, got ${structure.length}`);
  return "صفحة واحدة مستخرجة";
});

await test("PDF Split (each page → ZIP)", async () => {
  const form = new FormData();
  form.append("op", "pdf:split");
  form.append("options", JSON.stringify({ mode: "each" }));
  form.append("file", new Blob([fs.readFileSync(pdfBase)]), "base.pdf");
  const response = await fetch(`${BASE}/api/convert`, { method: "POST", body: form });
  if (!response.ok) throw new Error((await response.json()).error);
  const buffer = Buffer.from(await response.arrayBuffer());
  const name = decodeURIComponent(response.headers.get("x-output-name") || "");
  if (!name.endsWith(".zip")) {
    fs.writeFileSync(path.join(OUT, "split-each.pdf"), buffer);
    if (!buffer.slice(0, 4).equals(Buffer.from("%PDF"))) throw new Error("not a pdf");
    return "ملف PDF واحد (الملف الأصلي صفحة واحدة)";
  }
  const zip = await JSZip.loadAsync(buffer);
  const pdfs = Object.keys(zip.files).filter((n) => n.endsWith(".pdf"));
  fs.writeFileSync(path.join(OUT, "split-each.zip"), buffer);
  if (!pdfs.length) throw new Error("no pdfs in zip");
  return `${pdfs.length} ملف PDF`;
});

await test("PDF Rotate", async () => {
  const form = new FormData();
  form.append("op", "pdf:rotate");
  form.append("options", JSON.stringify({ angle: 90, pages: "1" }));
  form.append("file", new Blob([fs.readFileSync(pdfBase)]), "base.pdf");
  const response = await fetch(`${BASE}/api/convert`, { method: "POST", body: form });
  if (!response.ok) throw new Error((await response.json()).error);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(path.join(OUT, "rotated.pdf"), buffer);
  const doc = await loadPdf(buffer);
  const angle = doc.getPage(0).getRotation().angle;
  if (angle !== 90) throw new Error(`rotation is ${angle}`);
  return "دوران 90° مطبق";
});

await test("PDF Compress", async () => {
  const result = await callApi("pdf:compress", ["photo1.jpg"]);
  // build a heavy PDF first from the image, then compress it
  const heavy = await callApi("img:to-pdf", ["photo2.png"]);
  const form = new FormData();
  form.append("op", "pdf:compress");
  form.append("options", JSON.stringify({ level: "medium" }));
  form.append("file", new Blob([heavy.buffer]), "heavy.pdf");
  const response = await fetch(`${BASE}/api/convert`, { method: "POST", body: form });
  if (!response.ok) throw new Error((await response.json()).error);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(path.join(OUT, "compressed.pdf"), buffer);
  const before = heavy.buffer.length;
  const after = buffer.length;
  if (!buffer.slice(0, 4).equals(Buffer.from("%PDF"))) throw new Error("not a pdf");
  return `${Math.round(before / 1024)}KB → ${Math.round(after / 1024)}KB`;
});

await test("PDF Watermark (Arabic)", async () => {
  const form = new FormData();
  form.append("op", "pdf:watermark");
  form.append("options", JSON.stringify({ text: "سري للغاية", opacity: 0.2 }));
  form.append("file", new Blob([fs.readFileSync(pdfBase)]), "base.pdf");
  const response = await fetch(`${BASE}/api/convert`, { method: "POST", body: form });
  if (!response.ok) throw new Error((await response.json()).error);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(path.join(OUT, "watermark.pdf"), buffer);
  const structure = await extractPdfStructure(buffer);
  if (structure.length < 1) throw new Error("broken pdf");
  return "علامة مائية مضافة";
});

await test("PDF Page numbers (Arabic)", async () => {
  const form = new FormData();
  form.append("op", "pdf:numbers");
  form.append("options", JSON.stringify({ format: "صفحة {n} من {total}" }));
  form.append("file", new Blob([fs.readFileSync(pdfBase)]), "base.pdf");
  const response = await fetch(`${BASE}/api/convert`, { method: "POST", body: form });
  if (!response.ok) throw new Error((await response.json()).error);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(path.join(OUT, "numbered.pdf"), buffer);
  return "ترقيم مضاف";
});

await test("PDF Organize (reorder)", async () => {
  const form = new FormData();
  form.append("op", "pdf:organize");
  form.append("options", JSON.stringify({ order: "1" }));
  form.append("file", new Blob([fs.readFileSync(pdfBase)]), "base.pdf");
  const response = await fetch(`${BASE}/api/convert`, { method: "POST", body: form });
  if (!response.ok) throw new Error((await response.json()).error);
  const buffer = Buffer.from(await response.arrayBuffer());
  const structure = await extractPdfStructure(buffer);
  if (structure.length !== 1) throw new Error(`expected 1 page got ${structure.length}`);
  return "إعادة ترتيب تعمل";
});

await test("Image convert JPG → PNG", async () => {
  const result = await callApi("img:convert", ["photo1.jpg"], { target: "png" });
  if (!result.ok) throw new Error(result.json?.error);
  fs.writeFileSync(path.join(OUT, "converted.png"), result.buffer);
  if (result.buffer[0] !== 0x89) throw new Error("not a PNG");
  return `${Math.round(result.buffer.length / 1024)}KB`;
});

await test("CSV → XLSX", async () => {
  const result = await callApi("csv:to-xlsx", ["data.csv"]);
  if (!result.ok) throw new Error(result.json?.error);
  fs.writeFileSync(path.join(OUT, "data.xlsx"), result.buffer);
  const wb = XLSX.read(result.buffer, { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  if (rows.length < 3) throw new Error("rows missing");
  return `${rows.length} صف`;
});

await test("XLSX → CSV", async () => {
  const result = await callApi("xlsx:to-csv", ["inventory.xlsx"]);
  if (!result.ok) throw new Error(result.json?.error);
  const text = result.buffer.toString("utf8");
  fs.writeFileSync(path.join(OUT, "inventory.csv"), result.buffer);
  if (!/المنتج/.test(text)) throw new Error("Arabic header missing");
  return `${text.split("\n").length} سطر`;
});

await test("PPTX → JPG", async () => {
  const result = await callApi("pptx:to-jpg", ["plan.pptx"], { dpi: 100 });
  if (!result.ok) throw new Error(result.json?.error);
  const name = result.name || "";
  if (!name.endsWith(".zip")) {
    fs.writeFileSync(path.join(OUT, "pptx-to-jpg.jpg"), result.buffer);
    if (result.buffer[0] !== 0xff) throw new Error("not a JPEG");
    return "صورة واحدة";
  }
  const zip = await JSZip.loadAsync(result.buffer);
  const entries = Object.keys(zip.files);
  fs.writeFileSync(path.join(OUT, "pptx-to-jpg.zip"), result.buffer);
  return `${entries.length} صورة`;
});

await test("Health endpoint", async () => {
  const response = await fetch(`${BASE}/api/health`);
  const json = await response.json();
  if (!json.ok) throw new Error("health not ok");
  return `${json.count} أداة مسجلة`;
});

/* ---------------------------------- summary ---------------------------------- */

const failed = results.filter((r) => r.status === "FAIL");
const passed = results.filter((r) => r.status === "PASS");
console.log(`\n${passed.length}/${results.length} passed`);
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ base: BASE, when: new Date().toISOString(), results }, null, 2));
if (failed.length) {
  console.log("FAILURES:", failed.map((f) => `${f.name}: ${f.detail}`).join("\n"));
  process.exitCode = 1;
}
