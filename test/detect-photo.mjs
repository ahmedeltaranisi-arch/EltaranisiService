// Quick look at the detector on any real photo: writes an overlay + the warped crop.
import { createCanvas, loadImage } from "@napi-rs/canvas";
import fs from "node:fs";
import path from "node:path";
import { detectQuadDetailed, warpPerspective } from "../src/scan/perspective.js";

globalThis.document = { createElement: () => createCanvas(1, 1) };
const file = process.argv[2];
const outDir = "test/output/photo";
fs.mkdirSync(outDir, { recursive: true });

const image = await loadImage(file);
const canvas = createCanvas(image.width, image.height);
const ctx = canvas.getContext("2d");
ctx.drawImage(image, 0, 0);
const started = Date.now();
const result = detectQuadDetailed(canvas);
const ms = Date.now() - started;
const base = path.basename(file).replace(/\.[a-z]+$/i, "");
if (result.quad) {
  const quad = result.quad.map((p) => ({ x: p.x * image.width, y: p.y * image.height }));
  ctx.lineWidth = Math.max(3, Math.round(image.width / 250));
  ctx.strokeStyle = "#ff2d55";
  ctx.beginPath();
  quad.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = "#ff2d55";
  quad.forEach((p) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, ctx.lineWidth * 2.2, 0, Math.PI * 2);
    ctx.fill();
  });
  const warped = warpPerspective(canvas, quad, { maxSize: 1100 });
  fs.writeFileSync(path.join(outDir, `${base}-crop.jpg`), warped.toBuffer("image/jpeg", 0.9));
}
fs.writeFileSync(path.join(outDir, `${base}-overlay.jpg`), canvas.toBuffer("image/jpeg", 0.9));
console.log(`${file}: ${result.quad ? "found" : "MISS"} conf ${(result.confidence * 100).toFixed(0)}% source ${result.source} ${ms}ms`);
if (result.quad) console.log("corners:", result.quad.map((p) => `(${(p.x * image.width).toFixed(0)},${(p.y * image.height).toFixed(0)})`).join(" "));
