// Real-photo smoke test: detect the quad on the phone-photo fixtures and warp it.
import { createCanvas, loadImage } from "@napi-rs/canvas";
import fs from "node:fs";
import path from "node:path";
import { detectQuadDetailed, warpPerspective, quadToRect } from "../src/scan/perspective.js";
import { traceContours, simplifyPolygon, contourQuads, polygonPerimeter } from "../src/scan/detect.js";

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
// --- contour detection unit checks (synthetic rotated rectangle mask) ---
{
  const width = 320;
  const height = 240;
  const mask = new Uint8Array(width * height);
  const corners = [{ x: 60, y: 40 }, { x: 260, y: 60 }, { x: 250, y: 200 }, { x: 50, y: 190 }];
  const inside = (x, y) => {
    let hit = true;
    for (let i = 0; i < 4; i += 1) {
      const a = corners[i];
      const b = corners[(i + 1) % 4];
      const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
      if (cross < 0) hit = false;
    }
    return hit;
  };
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) if (inside(x, y)) mask[y * width + x] = 1;
  const contours = traceContours(mask, width, height, { maxContours: 4 });
  const perimeter = contours.length ? polygonPerimeter(contours[0]) : 0;
  const simplified = contours.length ? simplifyPolygon(contours[0], 4) : [];
  const quads = contourQuads(mask, width, height);
  const quad = quads[0];
  const cornerError = quad
    ? Math.max(...quad.map((point) => Math.min(...corners.map((c) => Math.hypot(c.x - point.x, c.y - point.y)))))
    : Infinity;
  console.log("contours".padEnd(22), `${contours.length} found, perimeter ${perimeter.toFixed(0)}, simplified ${simplified.length} points`);
  console.log("contour quad".padEnd(22), quad ? quad.map((p) => `(${p.x.toFixed(0)},${p.y.toFixed(0)})`).join(" ") : "MISS",
    `· corner error ${cornerError.toFixed(1)}px`);
  if (!contours.length || simplified.length !== 4 || !quad || cornerError > 6) {
    console.log("CONTOUR FAIL");
    process.exit(1);
  }
}

fs.writeFileSync(path.join(out, "detect-report.json"), JSON.stringify(report, null, 2));
const failed = report.filter((item) => !item.quad || item.areaRatio < 0.15 || item.areaRatio > 0.99);
if (failed.length) {
  console.log("DETECT FAIL:", failed.map((f) => f.name).join(", "));
  process.exit(1);
}
console.log("DETECT OK");
