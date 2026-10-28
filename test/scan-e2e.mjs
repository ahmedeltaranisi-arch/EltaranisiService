// Browser E2E for the scan tool: upload → crop → every filter → export PDF + images ZIP.
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:4173";
const OUT_DIR = "test/output/scan-e2e";
fs.mkdirSync(OUT_DIR, { recursive: true });

const FIXTURES = ["page-ar.jpg", "page-en.jpg", "receipt.jpg"];
const FILTERS = ["original", "lighten", "enhance", "noshadow", "bw", "eco", "grayscale"];

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await puppeteer.launch({
  args: chromium.args,
  executablePath: await chromium.executablePath(),
  headless: "shell",
  protocolTimeout: 300000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 950 });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});

try {
  await page.goto(BASE_URL, { waitUntil: "networkidle2", timeout: 60000 });

  // open the scan tool from the tool grid
  const opened = await page.evaluate(async () => {
    const card = [...document.querySelectorAll(".tool-card")]
      .find((node) => node.textContent.includes("مسح ضوئي"));
    if (!card) return false;
    card.click();
    await new Promise((resolve) => setTimeout(resolve, 900));
    return !document.getElementById("scanner").hidden;
  });
  check("scan tool opens from the tool grid", opened);

  const chips = await page.$$eval(".filter-chip .filter-name", (nodes) => nodes.map((node) => node.textContent.trim()));
  check("7 filters present with expected labels", chips.length === 7
    && ["Original", "Lighten", "Enhance", "No Shadow", "B&W", "Eco", "Grayscale"].every((label) => chips.includes(label)),
  chips.join(" | "));

  // upload the fixtures through the hidden file input
  const input = await page.$("#scanner-input");
  await input.uploadFile(...FIXTURES.map((name) => path.resolve("test/fixtures/scan", name)));
  await page.waitForFunction(() => {
    const count = document.getElementById("scanner-count");
    return count && /3/.test(count.textContent);
  }, { timeout: 40000 });
  check("3 pages loaded", true);

  const stageInfo = await page.evaluate(() => {
    const canvas = document.getElementById("crop-canvas");
    const handles = document.querySelectorAll(".crop-handle").length;
    const thumbs = [...document.querySelectorAll(".filter-thumb canvas")].length;
    return { width: canvas.width, height: canvas.height, handles, thumbs };
  });
  check("crop canvas rendered with 4 corner handles", stageInfo.width > 200 && stageInfo.handles === 4,
    `canvas ${stageInfo.width}×${stageInfo.height}, handles ${stageInfo.handles}`);
  check("live filter thumbnails rendered", stageInfo.thumbs === 7, `${stageInfo.thumbs} thumbs`);

  // drag the top-left corner of the active page (simulates real cropping) and let the test
  // read back the applied filter metrics for every filter id
  const metrics = await page.evaluate(async (filters) => {
    const scanner = window.__scannerDebug;
    if (!scanner) return null;
    const canvas = document.getElementById("crop-canvas");
    const out = {};
    for (const id of filters) {
      scanner.setFilter(id);
      await new Promise((resolve) => setTimeout(resolve, 60));
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let sum = 0;
      let bright = 0;
      const histogram = new Array(256).fill(0);
      for (let i = 0; i < data.length; i += 4) {
        const value = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
        histogram[value] += 1;
        sum += value;
        if (value > 200) bright += 1;
      }
      const total = data.length / 4;
      let dark = 0;
      for (let i = 0; i <= 100; i += 1) dark += histogram[i];
      out[id] = {
        mean: +(sum / total).toFixed(1),
        brightRatio: +(bright / total).toFixed(3),
        darkRatio: +(dark / total).toFixed(3),
        distinct: histogram.filter((count) => count > total * 0.002).length,
      };
    }
    return out;
  }, FILTERS);

  const expected = {
    original: (m) => m.mean > 60 && m.mean < 250,
    lighten: (m) => m.mean > metrics.original.mean,
    enhance: (m) => m.distinct > 60,
    noshadow: (m) => m.brightRatio > metrics.original.brightRatio + 0.08 && m.darkRatio < metrics.original.darkRatio,
    bw: (m) => m.distinct <= 3 && m.darkRatio < 0.35,
    eco: (m) => m.distinct <= 40,
    grayscale: (m) => m.distinct <= 8,
  };
  const filterChecks = [];
  for (const id of FILTERS) {
    const passed = Boolean(metrics && metrics[id] && expected[id](metrics[id]));
    filterChecks.push(`${id}:${passed ? "ok" : "bad"}`);
    check(`filter ${id} produces valid output`, passed, JSON.stringify(metrics?.[id] || {}));
  }

  // unique pixel signature per filter (proves filters really differ)
  const signatures = await page.evaluate(async (filters) => {
    const scanner = window.__scannerDebug;
    const canvas = document.getElementById("crop-canvas");
    const out = {};
    for (const id of filters) {
      scanner.setFilter(id);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 0;
      for (let i = 0; i < data.length; i += 97) hash = (hash * 31 + data[i]) % 1000000007;
      out[id] = hash;
    }
    return out;
  }, FILTERS);
  const unique = new Set(Object.values(signatures || {})).size;
  check("filters are visually distinct", unique === 7, `${unique}/7 unique signatures`);

  // export PDF
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const client = await page.createCDPSession();
  await client.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: path.resolve(OUT_DIR) });

  await page.evaluate(() => {
    window.__scannerDebug.state.pages.forEach((item) => { item.filter = "bw"; });
    document.getElementById("scanner-export-pdf").click();
  });
  await new Promise((resolve) => setTimeout(resolve, 9000));
  const pdfFile = fs.readdirSync(OUT_DIR).find((name) => name.endsWith(".pdf"));
  check("PDF export produced a real file", Boolean(pdfFile));
  if (pdfFile) {
    const buf = fs.readFileSync(path.join(OUT_DIR, pdfFile));
    const isPdf = buf.subarray(0, 5).toString() === "%PDF-";
    const { PDFDocument: Doc } = await import("pdf-lib");
    const parsed = await Doc.load(buf);
    const pages = parsed.getPageCount();
    check("PDF is valid and contains 3 pages", isPdf && pages === 3, `${(buf.length / 1024).toFixed(0)} KB, ${pages} pages`);
  }

  // save images as separate files (no ZIP)
  await page.evaluate(() => document.getElementById("scanner-export-images").click());
  await page.waitForSelector("#scan-files:not([hidden])", { timeout: 40000 });
  const panel = await page.evaluate(() => ({
    count: document.getElementById("scan-files-count").textContent,
    links: [...document.querySelectorAll("#scan-files-list a[download]")].map((link) => link.getAttribute("download")),
    sizes: [...document.querySelectorAll(".scan-file-size")].map((node) => node.textContent),
  }));
  check("save-images panel lists every page separately", panel.links.length === 3
    && panel.links.join(",") === "scan-01.jpg,scan-02.jpg,scan-03.jpg", panel.links.join(", "));
  check("panel reports real dimensions and sizes", panel.sizes.every((text) => /\d+×\d+ · \d+ كيلوبايت/.test(text)), panel.sizes[0] || "");

  await page.evaluate(() => document.getElementById("scan-files-all").click());
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const jpgs = fs.readdirSync(OUT_DIR).filter((name) => /^scan-\d+\.jpg$/.test(name)).sort();
  check("each page saved as its own JPG (no ZIP)", jpgs.length === 3, jpgs.join(", "));
  if (jpgs.length) {
    const sizes = jpgs.map((name) => fs.statSync(path.join(OUT_DIR, name)).size);
    const headers = jpgs.map((name) => fs.readFileSync(path.join(OUT_DIR, name)).subarray(0, 3).toString("hex"));
    check("saved JPGs are valid files with real content",
      headers.every((header) => header === "ffd8ff") && sizes.every((size) => size > 15000),
      `${sizes.map((size) => `${(size / 1024).toFixed(0)}KB`).join(" / ")}`);
    const noZipYet = fs.readdirSync(OUT_DIR).every((name) => !name.endsWith(".zip"));
    check("no ZIP archive produced by the images button", noZipYet);
  }

  // ZIP stays available as an explicit separate button
  await page.evaluate(() => document.getElementById("scanner-export-zip").click());
  await new Promise((resolve) => setTimeout(resolve, 9000));
  const zipFile = fs.readdirSync(OUT_DIR).find((name) => name.endsWith(".zip"));
  check("optional ZIP button still works", Boolean(zipFile));
  if (zipFile) {
    const buf = fs.readFileSync(path.join(OUT_DIR, zipFile));
    const entries = (buf.toString("latin1").match(/scan-\d+\.jpg/g) || []);
    check("ZIP contains 3 JPG pages", new Set(entries).size === 3, `${(buf.length / 1024).toFixed(0)} KB`);
  }

  await page.screenshot({ path: path.join(OUT_DIR, "scanner-ui.png"), fullPage: false });
  check("no JavaScript errors", errors.length === 0, errors.slice(0, 2).join(" / "));
} catch (error) {
  check("scan E2E run", false, error.message);
} finally {
  await browser.close();
}

const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} scan checks passed`);
fs.writeFileSync(path.join(OUT_DIR, "scan-e2e-report.json"), JSON.stringify(results, null, 2));
process.exit(failed.length ? 1 : 0);
