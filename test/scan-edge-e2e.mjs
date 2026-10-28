// E2E for the CamScanner-style edge tool: green boundary, draggable corners,
// مسح / إعادة ضبط / تأكيد / حفظ, pre-save preview and camera capture.
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:4173";
const FIXTURES = ["page-ar.jpg", "receipt.jpg", "card-photo-big.jpg"];
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await puppeteer.launch({
  args: [
    ...chromium.args,
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--allow-file-access-from-files",
  ],
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
  await page.waitForFunction(() => /3/.test(document.getElementById("scanner-count").textContent), { timeout: 60000 });

  // 1. green boundary + 4 handles
  const overlay = await page.evaluate(() => {
    const edges = [...document.querySelectorAll(".crop-edge")];
    const handles = [...document.querySelectorAll(".crop-handle")];
    const stroke = edges.length ? getComputedStyle(edges[0]).stroke : "";
    return {
      edges: edges.length,
      handles: handles.length,
      stroke,
      handleFill: handles.length ? getComputedStyle(handles[0]).fill : "",
    };
  });
  check("boundary drawn as 4 green edges", overlay.edges === 4 && /34,\s*197,\s*94|#22c55e/i.test(overlay.stroke), overlay.stroke);
  check("4 draggable corner handles", overlay.handles === 4, `${overlay.handles} handles, fill ${overlay.handleFill}`);

  // 2. dragging a handle moves that corner
  const drag = await page.evaluate(async () => {
    const debug = window.__scannerDebug;
    const active = () => debug.state.pages.find((p) => p.id === debug.state.activeId) || debug.state.pages[0];
    const before = JSON.parse(JSON.stringify(active().quad));
    const handle = document.querySelectorAll(".crop-handle")[0];
    const rect = handle.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const fire = (type, cx, cy) => handle.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, clientX: cx, clientY: cy, pointerId: 1, pointerType: "touch", isPrimary: true,
    }));
    fire("pointerdown", x, y);
    fire("pointermove", x + 25, y + 18);
    fire("pointerup", x + 25, y + 18);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const after = active().quad;
    const moved = Math.hypot(after[0].x - before[0].x, after[0].y - before[0].y);
    return { moved, manual: active().autoDetected === false };
  }).catch((error) => ({ moved: 0, error: String(error) }));
  check("corner handle drag updates the quad", drag.moved > 0.001, `Δ ${(drag.moved * 100).toFixed(1)}% of width`);

  // 3. مسح — re-detect puts the corners back on the document
  const detect = await page.evaluate(async () => {
    const debug = window.__scannerDebug;
    document.getElementById("scanner-scan").click();
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const pageState = debug.state.pages.find((p) => p.id === debug.state.activeId);
    return { auto: pageState.autoDetected, conf: pageState.confidence };
  });
  check("«مسح» re-detects the corners", detect.auto === true && detect.conf > 0.3, `confidence ${(detect.conf * 100).toFixed(0)}%`);

  // 4. إعادة ضبط — corners back to the whole frame
  const reset = await page.evaluate(async () => {
    const debug = window.__scannerDebug;
    const active = () => debug.state.pages.find((p) => p.id === debug.state.activeId);
    const autoQuad = JSON.parse(JSON.stringify(active().autoQuad));
    const before = JSON.parse(JSON.stringify(active().quad));
    document.getElementById("scanner-reset").click();
    await new Promise((resolve) => setTimeout(resolve, 400));
    const after = active().quad;
    const distance = Math.max(...after.map((point, index) => Math.hypot(
      point.x - autoQuad[index].x, point.y - autoQuad[index].y,
    )));
    return { distance, autoDetected: active().autoDetected, before };
  });
  check("«إعادة ضبط» restores the auto-detected corners", reset.distance < 0.001 && reset.autoDetected,
    `max deviation ${(reset.distance * 100).toFixed(2)}%`);

  // 5. تأكيد — bakes the crop, straightens the page and opens the preview
  const confirm = await page.evaluate(async () => {
    const debug = window.__scannerDebug;
    document.getElementById("scanner-scan").click();
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const active = () => debug.state.pages.find((p) => p.id === debug.state.activeId);
    const before = { w: active().canvas.width, h: active().canvas.height };
    document.getElementById("scanner-confirm").click();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const after = { w: active().canvas.width, h: active().canvas.height };
    const preview = document.getElementById("scan-preview");
    const canvas = document.getElementById("scan-preview-canvas");
    return {
      before, after,
      previewOpen: !preview.hidden,
      previewSize: `${canvas.width}×${canvas.height}`,
      quadReset: JSON.stringify(active().quad),
    };
  });
  check("«تأكيد» crops the page (canvas changes)", confirm.after.w !== confirm.before.w || confirm.after.h !== confirm.before.h,
    `${confirm.before.w}×${confirm.before.h} → ${confirm.after.w}×${confirm.after.h}`);
  check("preview opens automatically after confirm", confirm.previewOpen, `preview ${confirm.previewSize}`);

  const previewPixels = await page.evaluate(() => {
    const canvas = document.getElementById("scan-preview-canvas");
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += data[i];
    return { mean: +(sum / (data.length / 4)).toFixed(1) };
  });
  check("preview canvas contains the processed document", previewPixels.mean > 60, `mean red ${previewPixels.mean}`);

  // 6. preview navigation + close
  const nav = await page.evaluate(async () => {
    window.__scannerDebug.renderPreview(0);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const next = document.getElementById("scan-preview-next");
    const meta = () => document.getElementById("scan-preview-meta").textContent;
    const first = meta();
    next.click();
    await new Promise((resolve) => setTimeout(resolve, 400));
    const second = meta();
    document.getElementById("scan-preview-close").click();
    await new Promise((resolve) => setTimeout(resolve, 200));
    return { first, second, closed: document.getElementById("scan-preview").hidden };
  });
  check("preview shows every page and closes", nav.first !== nav.second && nav.closed, `${nav.first} → ${nav.second}`);

  // 7. camera capture (fake device)
  const camera = await page.evaluate(async () => {
    document.getElementById("scanner-camera-top").click();
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const modal = document.getElementById("scan-camera");
    const video = document.getElementById("scan-camera-video");
    const ready = Boolean(video.videoWidth);
    return { open: !modal.hidden, ready, size: `${video.videoWidth}×${video.videoHeight}` };
  });
  check("camera modal opens and streams", camera.open && camera.ready, camera.size);

  const captured = await page.evaluate(async () => {
    const before = window.__scannerDebug.state.pages.length;
    document.getElementById("scan-camera-shot").click();
    await new Promise((resolve) => setTimeout(resolve, 4000));
    const after = window.__scannerDebug.state.pages.length;
    return { before, after, closed: document.getElementById("scan-camera").hidden };
  });
  check("camera capture adds a new page", captured.after === captured.before + 1, `${captured.before} → ${captured.after} pages`);

  // 8. phone layout in a fresh mobile session: canvas clear of the buttons, no overflow
  const phonePage = await browser.newPage();
  await phonePage.setViewport({ width: 390, height: 780, isMobile: true, hasTouch: true });
  const phoneErrors = [];
  phonePage.on("pageerror", (error) => phoneErrors.push(String(error)));
  await phonePage.goto(BASE_URL, { waitUntil: "networkidle2", timeout: 60000 });
  await phonePage.evaluate(async () => {
    [...document.querySelectorAll(".tool-card")].find((node) => node.textContent.includes("مسح ضوئي")).click();
    await new Promise((resolve) => setTimeout(resolve, 900));
  });
  await (await phonePage.$("#scanner-input")).uploadFile(path.resolve("test/fixtures/scan/page-ar.jpg"));
  await phonePage.waitForFunction(() => /1/.test(document.getElementById("scanner-count").textContent), { timeout: 60000 });
  await new Promise((resolve) => setTimeout(resolve, 800));
  const phone = await phonePage.evaluate(() => {
    const root = document.getElementById("scanner");
    const overlay = document.getElementById("crop-overlay").getBoundingClientRect();
    const actions = document.getElementById("scan-main-actions").getBoundingClientRect();
    const filters = document.getElementById("filters-strip").getBoundingClientRect();
    return {
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      overlayBottom: Math.round(overlay.bottom),
      actionsTop: Math.round(actions.top),
      filtersTop: Math.round(filters.top),
      handles: document.querySelectorAll(".crop-handle").length,
      rootVisible: !root.hidden,
      rootDisplay: getComputedStyle(root).display,
      docHeight: document.documentElement.clientHeight,
    };
  });
  check("phone layout keeps the canvas clear of the buttons",
    phone.rootVisible && phone.overlayBottom > 40 && phone.actionsTop > 40
      && phone.overlayBottom <= phone.actionsTop + 2 && phone.actionsTop <= phone.filtersTop,
    `canvas ${phone.overlayBottom} ≤ actions ${phone.actionsTop} ≤ filters ${phone.filtersTop} (${JSON.stringify(phone)})`);
  check("no horizontal overflow on phone", phone.overflowX <= 1, `${phone.overflowX}px`);
  check("no JavaScript errors on phone", phoneErrors.length === 0, phoneErrors.slice(0, 2).join(" | "));
  await phonePage.screenshot({ path: "test/output/scan-edge-phone.png" });
  await phonePage.close();
  check("no JavaScript errors", errors.length === 0, errors.slice(0, 2).join(" | "));
} finally {
  await browser.close();
}

const passed = results.filter((result) => result.ok).length;
console.log(`\n${passed}/${results.length} edge-tool checks passed`);
if (passed !== results.length) process.exit(1);
