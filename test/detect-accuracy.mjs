// Accuracy gate for the document detector: two synthetic sets with ground truth
// (24 photos) + the real fixtures. Reports corner error, IoU and timing.
import { createCanvas, loadImage } from "@napi-rs/canvas";
import fs from "node:fs";
import path from "node:path";
import { detectDocumentQuad, orderQuad } from "../src/scan/detect.js";

globalThis.document = { createElement: (tag) => { if (tag !== "canvas") throw new Error("canvas only"); return createCanvas(1, 1); } };

const OUT = path.join(process.cwd(), "test", "output", "detect");
fs.mkdirSync(OUT, { recursive: true });

function insidePolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function quadIoU(a, b) {
  const minX = Math.min(...a.map((p) => p.x), ...b.map((p) => p.x));
  const maxX = Math.max(...a.map((p) => p.x), ...b.map((p) => p.x));
  const minY = Math.min(...a.map((p) => p.y), ...b.map((p) => p.y));
  const maxY = Math.max(...a.map((p) => p.y), ...b.map((p) => p.y));
  const steps = 110;
  let inter = 0;
  let union = 0;
  for (let i = 0; i < steps; i += 1) {
    for (let j = 0; j < steps; j += 1) {
      const point = { x: minX + ((maxX - minX) * (i + 0.5)) / steps, y: minY + ((maxY - minY) * (j + 0.5)) / steps };
      const inA = insidePolygon(point, a);
      const inB = insidePolygon(point, b);
      if (inA && inB) inter += 1;
      if (inA || inB) union += 1;
    }
  }
  return union ? inter / union : 0;
}

const SETS = [
  { key: "a", dir: path.join(process.cwd(), "test", "fixtures", "detect") },
  { key: "b", dir: path.join(process.cwd(), "test", "fixtures", "detect-b") },
];

const all = [];
for (const set of SETS) {
  const truthFile = path.join(set.dir, "truth.json");
  if (!fs.existsSync(truthFile)) continue;
  const truth = JSON.parse(fs.readFileSync(truthFile, "utf8"));
  console.log(`\n=== set ${set.key} (${truth.length} photos)`);
  for (const scene of truth) {
    const image = await loadImage(path.join(set.dir, `${scene.name}.jpg`));
    const canvas = createCanvas(image.width, image.height);
    canvas.getContext("2d").drawImage(image, 0, 0);
    const started = Date.now();
    const result = detectDocumentQuad(canvas);
    const ms = Date.now() - started;
    const truthQuad = orderQuad(scene.quad);
    let cornerError = null;
    let iou = 0;
    if (result.quad) {
      const found = result.quad.map((p) => ({ x: p.x * image.width, y: p.y * image.height }));
      cornerError = Math.max(...found.map((p, index) => Math.hypot(p.x - truthQuad[index].x, p.y - truthQuad[index].y)));
      iou = quadIoU(found, truthQuad);
    }
    const ok = iou >= 0.9;
    all.push({ set: set.key, name: scene.name, iou, cornerError, ms, confidence: result.confidence, source: result.source });
    console.log(`  ${scene.name.padEnd(20)} ${result.quad ? "found" : "MISS "} IoU ${iou.toFixed(3)}`
      + ` cornerErr ${cornerError === null ? "  -  " : `${cornerError.toFixed(1)}px`}`
      + ` conf ${result.confidence.toFixed(2)} ${String(result.source).padEnd(16)} ${ms}ms`);

    // overlay: ground truth green, detector magenta
    const sheet = createCanvas(image.width, image.height);
    const sctx = sheet.getContext("2d");
    sctx.drawImage(image, 0, 0);
    const drawPoly = (quad, color) => {
      sctx.strokeStyle = color;
      sctx.lineWidth = Math.max(2, image.width / 320);
      sctx.beginPath();
      quad.forEach((p, index) => (index ? sctx.lineTo(p.x, p.y) : sctx.moveTo(p.x, p.y)));
      sctx.closePath();
      sctx.stroke();
    };
    drawPoly(truthQuad, "#00e676");
    if (result.quad) drawPoly(result.quad.map((p) => ({ x: p.x * image.width, y: p.y * image.height })), "#ff3d7f");
    fs.writeFileSync(path.join(OUT, `${set.key}-${scene.name}-overlay.jpg`), sheet.toBuffer("image/jpeg", 0.8));
  }
}

const good = all.filter((row) => row.iou >= 0.9);
const avgIou = all.reduce((sum, row) => sum + row.iou, 0) / Math.max(1, all.length);
const avgError = good.reduce((sum, row) => sum + (row.cornerError || 0), 0) / Math.max(1, good.length);
const avgMs = all.reduce((sum, row) => sum + row.ms, 0) / Math.max(1, all.length);
console.log(`\nRESULT accurate (IoU ≥ 0.90): ${good.length}/${all.length}`
  + ` · avg IoU ${avgIou.toFixed(3)} · avg corner error ${avgError.toFixed(1)}px · avg ${avgMs.toFixed(0)}ms`);
fs.writeFileSync(path.join(OUT, "accuracy-report.json"), JSON.stringify({
  accurate: good.length, total: all.length, avgIou: +avgIou.toFixed(3), avgError: +avgError.toFixed(1), avgMs: +avgMs.toFixed(0), rows: all,
}, null, 2));

const required = Number(process.env.MIN_ACCURATE || 22);
if (good.length < required) {
  console.log(`ACCURACY FAIL: ${good.length} < ${required}`);
  process.exit(1);
}
console.log("ACCURACY OK");
