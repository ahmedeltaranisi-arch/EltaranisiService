import { createCanvas, loadImage } from "@napi-rs/canvas";
import fs from "node:fs";
const M = await import("../src/scan/detect.js");
globalThis.document = { createElement: () => createCanvas(1, 1) };
const setName = process.argv[3] === "b" ? "detect-b" : "detect";
const name = process.argv[2];
const scene = JSON.parse(fs.readFileSync(`test/fixtures/${setName}/truth.json`, "utf8")).find((s) => s.name === name);
const image = await loadImage(`test/fixtures/${setName}/${name}.jpg`);
const canvas = createCanvas(image.width, image.height);
canvas.getContext("2d").drawImage(image, 0, 0);
const result = M.detectDocumentQuad(canvas, { keepDebug: true });
console.log("chosen", result.source, JSON.stringify(result.debug));
const truthQuad = M.orderQuad(scene.quad);
function iou(a, b) {
  const inside = (p, poly) => { let r = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i++) { const A = poly[i], B = poly[j]; if ((A.y > p.y) !== (B.y > p.y) && p.x < ((B.x - A.x) * (p.y - A.y)) / (B.y - A.y) + A.x) r = !r; } return r; };
  const minX = Math.min(...a.map(p => p.x), ...b.map(p => p.x)), maxX = Math.max(...a.map(p => p.x), ...b.map(p => p.x));
  const minY = Math.min(...a.map(p => p.y), ...b.map(p => p.y)), maxY = Math.max(...a.map(p => p.y), ...b.map(p => p.y));
  const N = 100; let inter = 0, uni = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const p = { x: minX + (maxX - minX) * (i + .5) / N, y: minY + (maxY - minY) * (j + .5) / N }; const ia = inside(p, a), ib = inside(p, b); if (ia && ib) inter++; if (ia || ib) uni++; }
  return uni ? inter / uni : 0;
}
console.log("chosen IoU", result.quad ? iou(result.quad.map(p => ({ x: p.x * image.width, y: p.y * image.height })), truthQuad).toFixed(3) : "-");
console.log("truth quad px:", truthQuad.map(p => `(${Math.round(p.x)},${Math.round(p.y)})`).join(" "));
if (result.quad) console.log("found quad px:", result.quad.map(p => `(${Math.round(p.x * image.width)},${Math.round(p.y * image.height)})`).join(" "));
