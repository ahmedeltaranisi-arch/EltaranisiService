/**
 * Renders every scanner filter on the fixture photos (Node + canvas),
 * measures quality numbers and writes a visual contact sheet.
 */
import fs from "node:fs";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { applyFilter, FILTERS } from "../src/scan/filters.js";
import { warpPerspective, defaultQuad, rotateCanvas } from "../src/scan/perspective.js";

const dir = path.join(process.cwd(), "test", "fixtures", "scan");
const out = path.join(process.cwd(), "test", "output", "scan");
fs.mkdirSync(out, { recursive: true });

/** Minimal DOM shim so the browser modules run in Node (for tests only). */
globalThis.document = {
  createElement(tag) {
    if (tag !== "canvas") throw new Error("only canvas supported in tests");
    return createCanvas(1, 1);
  },
};

/** Measures paper whiteness / ink contrast of a page image. */
function metrics(canvas) {
  const ctx = canvas.getContext("2d");
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let sum = 0;
  let min = 255;
  let max = 0;
  let dark = 0;
  let bright = 0;
  const values = [];
  for (let i = 0; i < data.length; i += 4 * 7) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    values.push(lum);
    sum += lum;
    if (lum < min) min = lum;
    if (lum > max) max = lum;
    if (lum < 110) dark += 1;
    if (lum > 205) bright += 1;
  }
  values.sort((a, b) => a - b);
  const percentile = (p) => values[Math.floor(values.length * p)] || 0;
  return {
    mean: +(sum / values.length).toFixed(1),
    paper: +percentile(0.9).toFixed(1),
    ink: +percentile(0.05).toFixed(1),
    contrast: +(percentile(0.9) - percentile(0.05)).toFixed(1),
    darkRatio: +(dark / values.length).toFixed(3),
    brightRatio: +(bright / values.length).toFixed(3),
  };
}

const files = ["page-ar.jpg", "page-en.jpg", "receipt.jpg"];
const report = {};

for (const file of files) {
  const img = await loadImage(path.join(dir, file));
  const base = createCanvas(img.width, img.height);
  base.getContext("2d").drawImage(img, 0, 0);
  report[file] = { size: [img.width, img.height], filters: {} };

  const thumbs = [];
  for (const filter of FILTERS) {
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const started = Date.now();
    applyFilter(imageData, filter.id);
    ctx.putImageData(imageData, 0, 0);
    const ms = Date.now() - started;
    const stats = metrics(canvas);
    report[file].filters[filter.id] = { ...stats, ms, kb: Math.round(canvas.toBuffer("image/jpeg", 0.85).length / 1024) };
    fs.writeFileSync(path.join(out, `${file.replace(".jpg", "")}-${filter.id}.jpg`), canvas.toBuffer("image/jpeg", 0.88));
    const thumb = createCanvas(300, 400);
    thumb.getContext("2d").drawImage(canvas, 0, 0, 300, 400);
    thumbs.push({ label: filter.label, canvas: thumb, ms });
  }

  // contact sheet
  const sheet = createCanvas(300 * thumbs.length, 430);
  const sctx = sheet.getContext("2d");
  sctx.fillStyle = "#ffffff";
  sctx.fillRect(0, 0, sheet.width, sheet.height);
  thumbs.forEach((thumb, index) => {
    sctx.drawImage(thumb.canvas, index * 300, 0);
    sctx.fillStyle = "#111";
    sctx.font = "18px sans-serif";
    sctx.textAlign = "center";
    sctx.fillText(thumb.label, index * 300 + 150, 420);
  });
  fs.writeFileSync(path.join(out, `${file.replace(".jpg", "")}-sheet.jpg`), sheet.toBuffer("image/jpeg", 0.9));
}

// perspective warp check: crop the paper out of the rotated photo
const photo = await loadImage(path.join(dir, "page-ar.jpg"));
const source = createCanvas(photo.width, photo.height);
source.getContext("2d").drawImage(photo, 0, 0);
const quad = [
  { x: photo.width * 0.116, y: photo.height * 0.055 },
  { x: photo.width * 0.912, y: photo.height * 0.108 },
  { x: photo.width * 0.868, y: photo.height * 0.941 },
  { x: photo.width * 0.052, y: photo.height * 0.888 },
];
const warped = warpPerspective(source, quad);
const warpedCtx = warped.getContext("2d");
const warpedData = warpedCtx.getImageData(0, 0, warped.width, warped.height);
applyFilter(warpedData, "bw");
warpedCtx.putImageData(warpedData, 0, 0);
fs.writeFileSync(path.join(out, "warped-bw.jpg"), warped.toBuffer("image/jpeg", 0.92));
const warpedPlain = warpPerspective(source, quad);
fs.writeFileSync(path.join(out, "warped-original.jpg"), warpedPlain.toBuffer("image/jpeg", 0.92));
report.warp = { size: [warped.width, warped.height], metrics: metrics(warped) };

const rotated = rotateCanvas(source, 90);
report.rotate = { size: [rotated.width, rotated.height] };

fs.writeFileSync(path.join(out, "filter-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1).slice(0, 3000));
