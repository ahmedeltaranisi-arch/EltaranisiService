// Auto-detection check: warp each fixture with the detected quad and save the result.
import { createCanvas, loadImage } from "@napi-rs/canvas";
import fs from "node:fs";
import path from "node:path";
import { detectQuad, warpPerspective, quadToRect } from "../src/scan/perspective.js";

globalThis.document = { createElement: (tag) => { if (tag !== "canvas") throw new Error("canvas only"); return createCanvas(1, 1); } };

const out = path.join(process.cwd(), "test", "output", "scan");
fs.mkdirSync(out, { recursive: true });
const names = ["page-ar.jpg", "page-en.jpg", "receipt.jpg"];
const report = [];
for (const name of names) {
  const image = await loadImage(path.join(process.cwd(), "test", "fixtures", "scan", name));
  const canvas = createCanvas(image.width, image.height);
  canvas.getContext("2d").drawImage(image, 0, 0);
  const quad = detectQuad(canvas);
  const rect = quad ? quadToRect(quad) : null;
  const areaRatio = rect ? rect.width * rect.height : 0;
  report.push({ name, quad, areaRatio: +areaRatio.toFixed(3) });
  if (quad) {
    const pixelQuad = quad.map((point) => ({ x: point.x * image.width, y: point.y * image.height }));
    const warped = warpPerspective(canvas, pixelQuad, { maxSize: 1200 });
    fs.writeFileSync(path.join(out, `detect-${name}`), warped.toBuffer("image/jpeg", 0.88));
  }
  console.log(name, quad ? quad.map((p) => `(${p.x.toFixed(3)},${p.y.toFixed(3)})`).join(" ") : "null", "area", areaRatio.toFixed(3));
}
fs.writeFileSync(path.join(out, "detect-report.json"), JSON.stringify(report, null, 2));
if (report.some((item) => !item.quad || item.areaRatio < 0.25 || item.areaRatio > 0.98)) {
  console.log("DETECT FAIL");
  process.exit(1);
}
console.log("DETECT OK");
