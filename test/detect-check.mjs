// Real-photo smoke test: detect the quad on the phone-photo fixtures and warp it.
import { createCanvas, loadImage } from "@napi-rs/canvas";
import fs from "node:fs";
import path from "node:path";
import { detectQuadDetailed, warpPerspective, quadToRect } from "../src/scan/perspective.js";

globalThis.document = { createElement: (tag) => { if (tag !== "canvas") throw new Error("canvas only"); return createCanvas(1, 1); } };

const out = path.join(process.cwd(), "test", "output", "scan");
fs.mkdirSync(out, { recursive: true });
const names = ["page-ar.jpg", "page-en.jpg", "receipt.jpg", "card-photo-big.jpg"];
const report = [];
for (const name of names) {
  const image = await loadImage(path.join(process.cwd(), "test", "fixtures", "scan", name));
  const canvas = createCanvas(image.width, image.height);
  canvas.getContext("2d").drawImage(image, 0, 0);
  const started = Date.now();
  const detection = detectQuadDetailed(canvas);
  const ms = Date.now() - started;
  const quad = detection.quad;
  const rect = quad ? quadToRect(quad) : null;
  const areaRatio = rect ? rect.width * rect.height : 0;
  report.push({ name, quad, confidence: detection.confidence, areaRatio: +areaRatio.toFixed(3), ms });
  if (quad) {
    const pixelQuad = quad.map((point) => ({ x: point.x * image.width, y: point.y * image.height }));
    const warped = warpPerspective(canvas, pixelQuad, { maxSize: 900 });
    fs.writeFileSync(path.join(out, `detect-${name}`), warped.toBuffer("image/jpeg", 0.88));
  }
  console.log(name.padEnd(22), quad ? "found" : "MISS ", `conf ${(detection.confidence * 100).toFixed(0)}%`,
    "area", areaRatio.toFixed(3), `${ms}ms`);
}
fs.writeFileSync(path.join(out, "detect-report.json"), JSON.stringify(report, null, 2));
const failed = report.filter((item) => !item.quad || item.areaRatio < 0.15 || item.areaRatio > 0.99);
if (failed.length) {
  console.log("DETECT FAIL:", failed.map((f) => f.name).join(", "));
  process.exit(1);
}
console.log("DETECT OK");
