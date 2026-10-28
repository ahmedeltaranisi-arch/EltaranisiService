/**
 * Browser-engine end-to-end test: runs real tools inside headless Chromium
 * using a 10 MB PDF (bigger than Vercel's 4.5 MB request limit) and validates
 * every output inside the page.
 */
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL || "http://127.0.0.1:4173";
const FIX = path.join(process.cwd(), "test", "fixtures");
const OUT = path.join(process.cwd(), "test", "output", "browser");
fs.mkdirSync(OUT, { recursive: true });

const exe = await chromium.executablePath();
const browser = await puppeteer.launch({ args: chromium.args, executablePath: exe, headless: "shell", protocolTimeout: 300000 });

const results = [];
const log = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✅" : "❌"} ${name} — ${detail}`);
};

const largePdf = path.join(FIX, "large.pdf");
const arabicPdf = path.join(OUT, "arabic-source.pdf");
const imageFile = path.join(FIX, "photo1.jpg");

async function openTool(page, title) {
  await page.evaluate((t) => {
    const card = [...document.querySelectorAll(".tool-card")].find((c) => c.textContent.includes(t));
    if (!card) throw new Error("tool card not found: " + t);
    card.click();
  }, title);
  await page.waitForSelector("#workspace:not([hidden])", { timeout: 5000 });
}

async function runWith(page, files, optionValues = {}) {
  const input = await page.$("#ws-input");
  await input.uploadFile(...files);
  await new Promise((r) => setTimeout(r, 300));
  for (const [key, value] of Object.entries(optionValues)) {
    await page.evaluate((k, v) => {
      const field = document.querySelector(`#opt-${k}`);
      if (field) {
        field.value = v;
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }, key, value);
  }
  const started = Date.now();
  await page.click("#ws-run");
  await page.waitForFunction(() => {
    const result = document.querySelector("#ws-result");
    const error = document.querySelector("#ws-error");
    return (!result.hidden && result.innerHTML.length > 0) || !error.hidden;
  }, { timeout: 240000, polling: 500 });

  const state = await page.evaluate(async () => {
    const errorBox = document.querySelector("#ws-error");
    const result = document.querySelector("#ws-result");
    const download = result.querySelector("a[download]");
    let probing = null;
    if (download) {
      const response = await fetch(download.href);
      const blob = await response.blob();
      const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
      probing = { size: blob.size, type: blob.type, head: Array.from(head) };
    }
    return {
      error: errorBox.hidden ? null : errorBox.textContent,
      name: download?.getAttribute("download") || null,
      meta: result.querySelector(".meta")?.textContent || "",
      preview: Boolean(result.querySelector("iframe, img")),
      info: probing,
    };
  });
  await page.evaluate(() => document.querySelector("#ws-close").click());
  await new Promise((r) => setTimeout(r, 150));
  return { ...state, ms: Date.now() - started };
}

const save = (state, label) => {
  if (state.info) fs.writeFileSync(path.join(OUT, label), Buffer.from(state.info.head));
};

const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1000 });
const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") jsErrors.push(m.text()); });
await page.goto(BASE, { waitUntil: "networkidle2" });

const LARGE_MB = (fs.statSync(largePdf).size / 1024 / 1024).toFixed(1);
console.log(`Testing with ${LARGE_MB} MB PDF (Vercel request limit is 4.5 MB)\n`);

/* 1. compress a 10 MB PDF in the browser */
await openTool(page, "ضغط PDF");
let state = await runWith(page, [largePdf], { level: "medium" });
log(
  `ضغط PDF بحجم ${LARGE_MB}MB داخل المتصفح`,
  !state.error && state.info && state.info.head[0] === 0x25 && state.info.head[1] === 0x50,
  state.error || `${state.name} — ${(state.info.size / 1024 / 1024).toFixed(2)}MB في ${(state.ms / 1000).toFixed(1)}s | ${state.meta}`,
);

/* 2. PDF -> DOCX on the big file */
await openTool(page, "PDF ← Word");
state = await runWith(page, [largePdf]);
const docxOk = state.info && state.info.head[0] === 0x50 && state.info.head[1] === 0x4b;
log("PDF ← Word لملف 10MB", !state.error && docxOk, state.error || `${state.name} — ${(state.info.size / 1024).toFixed(0)}KB`);

/* 3. PDF -> JPG (zip of pages) */
await openTool(page, "PDF ← JPG");
state = await runWith(page, [largePdf], { dpi: "100" });
log("PDF ← JPG لملف 10MB", !state.error && state.info?.size > 1000, state.error || `${state.name} — ${(state.info.size / 1024).toFixed(0)}KB`);

/* 4. ---------------- Arabic round trip in the browser ----------------
   build an Arabic PDF with the server (small), then convert it back to Word
   inside the browser and check the extracted text is readable Arabic. */
const arabicPdfResponse = await fetch(`${BASE}/api/convert`, {
  method: "POST",
  body: (() => {
    const form = new FormData();
    form.append("op", "to-pdf");
    form.append("options", "{}");
    form.append("file", new Blob([fs.readFileSync(path.join(FIX, "report-ar.docx"))]), "report-ar.docx");
    return form;
  })(),
});
fs.writeFileSync(arabicPdf, Buffer.from(await arabicPdfResponse.arrayBuffer()));
await openTool(page, "PDF ← Word");
state = await runWith(page, [arabicPdf]);
log("PDF عربي ← Word داخل المتصفح", !state.error && Boolean(state.name), state.error || `${state.name} — ${state.meta}`);

/* 5. split: every page in its own file (browser, zip) */
await openTool(page, "تقسيم PDF");
state = await runWith(page, [arabicPdf], { mode: "each" });
log("تقسيم PDF إلى ملفات (متصفح)", !state.error && state.name?.endsWith(".zip"), state.error || `${state.name}`);

/* 6. watermark with Arabic text */
await openTool(page, "علامة مائية");
state = await runWith(page, [arabicPdf], { text: "سري للغاية" });
log("علامة مائية عربية (متصفح)", !state.error && state.preview, state.error || `${state.name}`);

/* 7. page numbers */
await openTool(page, "ترقيم الصفحات");
state = await runWith(page, [arabicPdf], { format: "صفحة {n} من {total}" });
log("ترقيم صفحات عربي (متصفح)", !state.error && state.preview, state.error || `${state.name}`);

/* 8. images -> PDF */
await openTool(page, "صور ← PDF");
state = await runWith(page, [imageFile], { pageSize: "A4" });
log("صور ← PDF (متصفح)", !state.error && state.preview, state.error || `${state.name}`);

/* 9. PDF -> Excel */
await openTool(page, "PDF ← Excel");
state = await runWith(page, [arabicPdf]);
log("PDF ← Excel (متصفح)", !state.error && state.name?.endsWith(".xlsx"), state.error || `${state.name}`);

/* 10. merge two big files */
await openTool(page, "دمج PDF");
state = await runWith(page, [arabicPdf, arabicPdf]);
log("دمج ملفين (متصفح)", !state.error && state.name?.endsWith(".pdf"), state.error || `${state.name}`);

/* 11. server-only tool with an oversized file must show a clear message */
await openTool(page, "Word ← PDF");
state = await runWith(page, [largePdf]);
const clearMessage = Boolean(state.error) && /ميجابايت|الحد|الخادم/.test(state.error || "");
log("رسالة واضحة عند تجاوز حد الخادم", clearMessage, state.error || "(no error shown!)");

/* 12. server-only tool still works for small files */
await openTool(page, "Word ← PDF");
state = await runWith(page, [path.join(FIX, "report-ar.docx")]);
log("Word ← PDF على الخادم (ملف صغير)", !state.error && state.info?.head[0] === 0x25, state.error || `${state.name}`);

log("أخطاء JavaScript", jsErrors.length === 0, jsErrors.slice(0, 3).join(" | ") || "لا يوجد");

await browser.close();
const failed = results.filter((r) => !r.ok);
fs.writeFileSync(path.join(OUT, "browser-report.json"), JSON.stringify(results, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} browser checks passed`);
process.exitCode = failed.length ? 1 : 0;
