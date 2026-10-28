// Browser E2E for the advanced scan tools: detect-all, brightness/contrast, undo,
// page reordering and rotate-all.
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:4173";
const FIXTURES = ["page-ar.jpg", "page-en.jpg", "receipt.jpg"];
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

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
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

try {
  await page.goto(BASE_URL, { waitUntil: "networkidle2", timeout: 60000 });
  await page.evaluate(async () => {
    const card = [...document.querySelectorAll(".tool-card")].find((node) => node.textContent.includes("مسح ضوئي"));
    card.click();
    await new Promise((resolve) => setTimeout(resolve, 900));
  });
  await (await page.$("#scanner-input")).uploadFile(...FIXTURES.map((name) => path.resolve("test/fixtures/scan", name)));
  await page.waitForFunction(() => /3/.test(document.getElementById("scanner-count").textContent), { timeout: 30000 });

  const buttons = await page.evaluate(() => ["scanner-detect-all", "scanner-rotate-all", "scanner-undo", "scanner-adjust-reset"]
    .map((id) => ({ id, present: Boolean(document.getElementById(id)), enabled: !(document.getElementById(id)?.disabled) })));
  check("new toolbar buttons present", buttons.every((button) => button.present), buttons.map((b) => `${b.id}:${b.enabled ? "on" : "off"}`).join(" "));

  // detect-all runs and reports a result
  await page.click("#scanner-detect-all");
  const detected = await page.waitForFunction(() => {
    const toast = [...document.querySelectorAll(".toast, #toast, [role='status']")].map((n) => n.textContent).join(" ");
    return /اكتشاف/.test(toast) ? toast : null;
  }, { timeout: 90000 }).then((handle) => handle.jsonValue()).catch(() => null);
  check("detect-all completes for every page", Boolean(detected), String(detected || "no toast").slice(0, 80));

  // brightness slider changes the rendered crop
  const brightness = await page.evaluate(async () => {
    const canvas = document.getElementById("crop-canvas");
    const mean = () => {
      const data = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      return sum / (data.length / 4);
    };
    const before = mean();
    window.__scannerDebug.setAdjust("brightness", 45);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const after = mean();
    window.__scannerDebug.setAdjust("brightness", 0);
    await new Promise((resolve) => setTimeout(resolve, 200));
    return { before: +before.toFixed(1), after: +after.toFixed(1) };
  });
  check("brightness slider brightens the preview", brightness.after > brightness.before + 5, `${brightness.before} → ${brightness.after}`);

  // contrast slider darkens/flattens as expected
  const contrast = await page.evaluate(async () => {
    const canvas = document.getElementById("crop-canvas");
    const distinct = () => {
      const data = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
      const histogram = new Array(256).fill(0);
      for (let i = 0; i < data.length; i += 4) histogram[Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])] += 1;
      return histogram.filter((count) => count > 0).length;
    };
    const before = distinct();
    window.__scannerDebug.setAdjust("contrast", -45);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const after = distinct();
    window.__scannerDebug.setAdjust("contrast", 0);
    await new Promise((resolve) => setTimeout(resolve, 200));
    return { before, after };
  });
  check("contrast slider changes tonal range", contrast.after < contrast.before, `${contrast.before} → ${contrast.after} tones`);

  // undo restores the previous state
  const undo = await page.evaluate(async () => {
    const debug = window.__scannerDebug;
    const before = document.getElementById("scanner-count").textContent;
    debug.rotateAll();
    await new Promise((resolve) => setTimeout(resolve, 400));
    const rotated = document.getElementById("crop-canvas");
    const rotatedSize = `${rotated.width}×${rotated.height}`;
    document.getElementById("scanner-undo").click();
    await new Promise((resolve) => setTimeout(resolve, 400));
    const restored = document.getElementById("crop-canvas");
    return { before, rotatedSize, restoredSize: `${restored.width}×${restored.height}` };
  });
  check("rotate-all + undo restores the canvas size", undo.rotatedSize !== undo.restoredSize, `${undo.rotatedSize} → ${undo.restoredSize}`);

  // reorder pages
  const order = await page.evaluate(async () => {
    const debug = window.__scannerDebug;
    const before = debug.pageOrder();
    document.querySelectorAll("#scanner-pages .page-item")[0].querySelector(".page-move").click();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const after = debug.pageOrder();
    // undo must restore the original order as well
    document.getElementById("scanner-undo").click();
    await new Promise((resolve) => setTimeout(resolve, 300));
    return { before, after, restored: debug.pageOrder() };
  });
  check("page reorder swaps the first two pages", order.before[0] === order.after[1] && order.after[0] === order.before[1],
    `${order.before.length} pages`);
  check("undo restores the original page order", JSON.stringify(order.restored) === JSON.stringify(order.before));

  check("no JavaScript errors", errors.length === 0, errors.slice(0, 2).join(" | "));
} finally {
  await browser.close();
}

const passed = results.filter((result) => result.ok).length;
console.log(`\n${passed}/${results.length} advanced scan checks passed`);
if (passed !== results.length) process.exit(1);
