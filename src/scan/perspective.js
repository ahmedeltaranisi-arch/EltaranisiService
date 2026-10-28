/* Geometry helpers for cropping / perspective correction of scanned photos. */

/** Solves A·x = b with Gaussian elimination (A must be n×n). */
function solveLinearSystem(matrix, vector) {
  const n = vector.length;
  const a = matrix.map((row) => row.slice());
  const b = vector.slice();
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-10) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    [b[col], b[pivot]] = [b[pivot], b[col]];
    const divisor = a[col][col];
    for (let k = col; k < n; k += 1) a[col][k] /= divisor;
    b[col] /= divisor;
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      if (!factor) continue;
      for (let k = col; k < n; k += 1) a[row][k] -= factor * a[col][k];
      b[row] -= factor * b[col];
    }
  }
  return b;
}

/**
 * Homography mapping destination quad points to source quad points
 * (dest -> src), so we can inverse-sample while warping.
 * Points: [{x,y}, ...] of length 4, ordered TL, TR, BR, BL.
 */
export function homography(dest, src) {
  const matrix = [];
  const vector = [];
  for (let i = 0; i < 4; i += 1) {
    const { x, y } = dest[i];
    const { x: u, y: v } = src[i];
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    vector.push(u);
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    vector.push(v);
  }
  const solved = solveLinearSystem(matrix, vector);
  if (!solved) return null;
  return [
    solved[0], solved[1], solved[2],
    solved[3], solved[4], solved[5],
    solved[6], solved[7], 1,
  ];
}

function applyH(h, x, y) {
  const w = h[6] * x + h[7] * y + h[8];
  return {
    x: (h[0] * x + h[1] * y + h[2]) / w,
    y: (h[3] * x + h[4] * y + h[5]) / w,
  };
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Warps the quadrilateral `quad` (TL,TR,BR,BL in source coordinates) into a
 * straight rectangle. Works on an offscreen canvas and returns a new canvas.
 */
export function warpPerspective(sourceCanvas, quad, { maxSize = 2600 } = {}) {
  const [tl, tr, br, bl] = quad;
  let width = Math.round(Math.max(dist(tl, tr), dist(bl, br)));
  let height = Math.round(Math.max(dist(tl, bl), dist(tr, br)));
  width = Math.max(8, Math.min(maxSize, width));
  height = Math.max(8, Math.min(maxSize, height));

  const srcCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
  const src = srcCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);

  const destQuad = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
  const h = homography(destQuad, quad);

  const target = document.createElement("canvas");
  target.width = width;
  target.height = height;
  const targetCtx = target.getContext("2d");
  const out = targetCtx.createImageData(width, height);
  const srcData = src.data;

  if (!h) {
    // degenerate quad: fall back to a plain crop of the bounding box
    const minX = Math.max(0, Math.min(tl.x, tr.x, br.x, bl.x));
    const minY = Math.max(0, Math.min(tl.y, tr.y, br.y, bl.y));
    const maxX = Math.min(sourceCanvas.width, Math.max(tl.x, tr.x, br.x, bl.x));
    const maxY = Math.min(sourceCanvas.height, Math.max(tl.y, tr.y, br.y, bl.y));
    target.width = Math.max(8, Math.round(maxX - minX));
    target.height = Math.max(8, Math.round(maxY - minY));
    targetCtx.drawImage(sourceCanvas, minX, minY, target.width, target.height, 0, 0, target.width, target.height);
    return target;
  }

  const sw = sourceCanvas.width;
  const sh = sourceCanvas.height;
  const outData = out.data;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = applyH(h, x + 0.5, y + 0.5);
      const sx = p.x - 0.5;
      const sy = p.y - 0.5;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      const x1 = Math.min(sw - 1, Math.max(0, x0 + 1));
      const y1 = Math.min(sh - 1, Math.max(0, y0 + 1));
      const cx0 = Math.min(sw - 1, Math.max(0, x0));
      const cy0 = Math.min(sh - 1, Math.max(0, y0));
      const i00 = (cy0 * sw + cx0) * 4;
      const i10 = (cy0 * sw + x1) * 4;
      const i01 = (y1 * sw + cx0) * 4;
      const i11 = (y1 * sw + x1) * 4;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;
      const o = (y * width + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        outData[o + c] = srcData[i00 + c] * w00 + srcData[i10 + c] * w10 + srcData[i01 + c] * w01 + srcData[i11 + c] * w11;
      }
      outData[o + 3] = 255;
    }
  }
  targetCtx.putImageData(out, 0, 0);
  return target;
}

/** Plain rectangular crop (axis aligned). */
export function cropRect(sourceCanvas, rect, { maxSize = 2600 } = {}) {
  const x = Math.max(0, Math.round(rect.x));
  const y = Math.max(0, Math.round(rect.y));
  const w = Math.max(8, Math.min(sourceCanvas.width - x, Math.round(rect.width)));
  const h = Math.max(8, Math.min(sourceCanvas.height - y, Math.round(rect.height)));
  const scale = Math.min(1, maxSize / Math.max(w, h));
  const target = document.createElement("canvas");
  target.width = Math.max(8, Math.round(w * scale));
  target.height = Math.max(8, Math.round(h * scale));
  const ctx = target.getContext("2d");
  ctx.drawImage(sourceCanvas, x, y, w, h, 0, 0, target.width, target.height);
  return target;
}

/** Rotates a canvas by a multiple of 90°. */
export function rotateCanvas(sourceCanvas, angle = 90) {
  const normalized = ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
  if (!normalized) return sourceCanvas;
  const swap = normalized === 90 || normalized === 270;
  const target = document.createElement("canvas");
  target.width = swap ? sourceCanvas.height : sourceCanvas.width;
  target.height = swap ? sourceCanvas.width : sourceCanvas.height;
  const ctx = target.getContext("2d");
  ctx.translate(target.width / 2, target.height / 2);
  ctx.rotate((normalized * Math.PI) / 180);
  ctx.drawImage(sourceCanvas, -sourceCanvas.width / 2, -sourceCanvas.height / 2);
  return target;
}

/** Flips a canvas horizontally. */
export function flipCanvas(sourceCanvas) {
  const target = document.createElement("canvas");
  target.width = sourceCanvas.width;
  target.height = sourceCanvas.height;
  const ctx = target.getContext("2d");
  ctx.translate(target.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(sourceCanvas, 0, 0);
  return target;
}

/** Default crop quad = the full page with a small inset margin. */
export function defaultQuad(width, height, inset = 0.04) {
  const dx = width * inset;
  const dy = height * inset;
  return [
    { x: dx, y: dy },
    { x: width - dx, y: dy },
    { x: width - dx, y: height - dy },
    { x: dx, y: height - dy },
  ];
}

export function quadToRect(quad) {
  const xs = quad.map((point) => point.x);
  const ys = quad.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

export function isRectangular(quad) {
  const [tl, tr, br, bl] = quad;
  const tolerance = 1.5;
  return Math.abs(tl.y - tr.y) < tolerance && Math.abs(bl.y - br.y) < tolerance
    && Math.abs(tl.x - bl.x) < tolerance && Math.abs(tr.x - br.x) < tolerance;
}

export function rectToQuad(rect) {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
}

/**
 * Detects the document quad automatically: the brightest large region of the photo
 * (the paper) is isolated, its largest connected component is taken, and the four
 * extreme points of that blob become the corner handles.
 * Returns normalized points [TL, TR, BR, BL] or null when nothing convincing is found.
 */
export function detectQuad(canvas, { samples = 360 } = {}) {
  const scale = Math.min(1, samples / Math.max(canvas.width, canvas.height));
  const width = Math.max(24, Math.round(canvas.width * scale));
  const height = Math.max(24, Math.round(canvas.height * scale));
  const small = document.createElement("canvas");
  small.width = width;
  small.height = height;
  const ctx = small.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);

  const gray = new Float32Array(width * height);
  const saturation = new Float32Array(width * height);
  const value = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    gray[p] = 0.299 * r + 0.587 * g + 0.114 * b;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    saturation[p] = max === 0 ? 0 : (max - min) / max;
    value[p] = max;
  }
  const radius = Math.max(2, Math.round(Math.max(width, height) / 60));
  const blurred = boxBlurPlane(gray, width, height, radius);
  const threshold = Math.max(60, otsu(blurred));

  // 1. try several brightness thresholds: the document is usually the bright, compact region.
  //    A higher threshold isolates the paper/card core even on a textured background.
  const relative = Math.max(1, 255 - threshold);
  const thresholds = [threshold, threshold + relative * 0.2, threshold + relative * 0.35, threshold + relative * 0.5]
    .map((value) => Math.min(250, Math.round(value)));

  const gradient = sobelPlane(blurred, width, height);
  let gradientSum = 0;
  for (let p = 0; p < gradient.length; p += 1) gradientSum += gradient[p];
  const gradientMean = gradientSum / gradient.length || 1;

  const minBlob = Math.round(width * height * 0.015);
  const candidates = [];
  for (const limit of thresholds) {
    const mask = new Uint8Array(width * height);
    for (let p = 0; p < mask.length; p += 1) mask[p] = blurred[p] >= limit ? 1 : 0;
    const opened = dilate(erode(mask, width, height), width, height);
    for (let p = 0; p < mask.length; p += 1) mask[p] = opened[p] && mask[p] ? 1 : 0;

    const blobs = componentsOf(mask, width, height, minBlob).slice(0, 2);
    for (const pixels of blobs) {
      const points = pixels.map((p) => ({ x: p % width, y: (p - (p % width)) / width }));
      const hull = convexHull(points);
      const rect = minAreaRect(hull);
      if (!rect) continue;
      const hullArea = Math.abs(hull.reduce((sum, point, index) => {
        const next = hull[(index + 1) % hull.length];
        return sum + point.x * next.y - next.x * point.y;
      }, 0)) / 2;
      const solidity = Math.max(0, Math.min(1, points.length / Math.max(1, hullArea)));
      const weight = Math.sqrt(points.length) * solidity * solidity;
      candidates.push({ quad: rect.corners, points, weight, kind: `rect@${limit}` });
      candidates.push({ quad: growQuad(rect.corners, 1.03), points, weight: weight * 0.95, kind: `rect3@${limit}` });
      candidates.push({ quad: growQuad(rect.corners, 1.07), points, weight: weight * 0.9, kind: `rect7@${limit}` });
    }
  }
  if (!candidates.length) return null;

  let best = null;
  for (const candidate of candidates) {
    const score = scoreQuadOnEdges(candidate.quad, {
      gray, gradient, gradientMean, width, height, points: candidate.points,
    });
    if (!score) continue;
    const total = score.total + Math.sqrt(candidate.weight) * 0.02;
    if (globalThis.__SCAN_DETECT_DEBUG__) {
      globalThis.__SCAN_DETECT_DEBUG__.push({
        kind: candidate.kind,
        quad: candidate.quad.map((p) => [+(p.x / width).toFixed(3), +(p.y / height).toFixed(3)]),
        step: +score.step.toFixed(2),
        fill: +score.fill.toFixed(2),
        total: +total.toFixed(2),
      });
    }
    if (!best || total > best.total) best = { quad: candidate.quad, score, total };
  }
  if (!best || best.score.step < 4.5 || best.score.fill < 0.35) return null;

  // coloured strips (national-ID cards, badges, folders) sit right next to the paper core:
  // grow an edge outward while the pixels just outside are vivid and bright
  const extended = extendOverColouredArea(best.quad, { saturation, value, width, height });

  // normalize to 0..1 and clamp away from the very edge
  return extended.map((point) => ({
    x: Math.min(1, Math.max(0, point.x / width)),
    y: Math.min(1, Math.max(0, point.y / height)),
  }));
}

/**
 * Grows each quad edge outward while the band just outside is a vivid, bright coloured
 * area (the blue/red strip on ID cards). Leaves edges untouched on normal backgrounds.
 */
function extendOverColouredArea(quad, { saturation, value, width, height }) {
  const docColour = (x, y) => {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= width || iy >= height) return false;
    const index = iy * width + ix;
    return value[index] >= 140 && saturation[index] >= 0.4;
  };
  const centre = {
    x: (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4,
    y: (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4,
  };
  const offsets = [0, 0, 0, 0];
  for (let edge = 0; edge < 4; edge += 1) {
    const a = quad[edge];
    const b = quad[(edge + 1) % 4];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1;
    let nx = dy / length;
    let ny = -dx / length;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    if ((mx - centre.x) * nx + (my - centre.y) * ny < 0) { nx = -nx; ny = -ny; }
    const maxDistance = Math.round(length * 0.25);
    let gap = 0;
    let reached = 0;
    for (let d = 1; d <= maxDistance; d += 1) {
      let hits = 0;
      let samples = 0;
      for (let k = 1; k <= 15; k += 1) {
        const t = k / 16;
        if (docColour(a.x + dx * t + nx * d, a.y + dy * t + ny * d)) hits += 1;
        samples += 1;
      }
      if (hits / samples >= 0.6) {
        reached = d;
        gap = 0;
      } else {
        gap += 1;
        if (gap > 2) break;
      }
    }
    offsets[edge] = reached;
  }
  if (!offsets.some((offset) => offset > 0)) return quad;
  return quad.map((point, index) => {
    let x = point.x;
    let y = point.y;
    for (const edge of [(index + 3) % 4, index]) {
      const offset = offsets[edge];
      if (!offset) continue;
      const a = quad[edge];
      const b = quad[(edge + 1) % 4];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.hypot(dx, dy) || 1;
      let nx = dy / length;
      let ny = -dx / length;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      if ((mx - centre.x) * nx + (my - centre.y) * ny < 0) { nx = -nx; ny = -ny; }
      x += nx * offset;
      y += ny * offset;
    }
    return { x, y };
  });
}

/** Point-in-quad test (quad ordered TL, TR, BR, BL). */
function pointInQuad(point, quad) {
  let sign = 0;
  for (let i = 0; i < 4; i += 1) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    if (Math.abs(cross) < 1e-9) continue;
    const current = Math.sign(cross);
    if (!sign) sign = current;
    else if (sign !== current) return false;
  }
  return true;
}

/** Scales a quad around its centre. */
function growQuad(quad, factor) {
  const cx = (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4;
  const cy = (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4;
  return quad.map((point) => ({
    x: cx + (point.x - cx) * factor,
    y: cy + (point.y - cy) * factor,
  }));
}

/** Four extreme corner points of a blob (works for rotated / perspective quads). */
function extremeQuad(points) {
  if (!points.length) return null;
  let tl = null; let tr = null; let br = null; let bl = null;
  let a = Infinity; let b = -Infinity; let c = -Infinity; let d = Infinity;
  for (const point of points) {
    const sum = point.x + point.y;
    const diff = point.x - point.y;
    if (sum < a) { a = sum; tl = point; }
    if (diff > b) { b = diff; tr = point; }
    if (sum > c) { c = sum; br = point; }
    if (diff < d) { d = diff; bl = point; }
  }
  return [tl, tr, br, bl];
}

/**
 * Scores a quad by how well its four edges sit on a real boundary:
 * brightness/texture step across the edge plus gradient strength along it.
 */
function scoreQuadOnEdges(quad, { gray, gradient, gradientMean, width, height, points = [] }) {
  if (!quad || quad.some((point) => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y))) return null;
  const area = Math.abs(quad.reduce((sum, point, index) => {
    const next = quad[(index + 1) % 4];
    return sum + point.x * next.y - next.x * point.y;
  }, 0)) / 2;
  const areaRatio = area / (width * height);
  if (areaRatio < 0.02 || areaRatio > 0.96) return null;

  const centre = {
    x: (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4,
    y: (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4,
  };
  const inGap = 0.05;
  const outGap = 0.07;
  const sample = (plane, x, y) => {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 2 || iy < 2 || ix >= width - 2 || iy >= height - 2) return null;
    return plane[iy * width + ix];
  };
  const steps = new Float64Array(4);
  const inner = [];
  const outer = [];
  const grads = [];
  for (let edge = 0; edge < 4; edge += 1) {
    const a = quad[edge];
    const b = quad[(edge + 1) % 4];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const samplesAlong = Math.max(6, Math.min(40, Math.round(length / 6)));
    let innerSum = 0; let outerSum = 0; let innerCount = 0; let outerCount = 0; let gradSum = 0;
    for (let s = 1; s < samplesAlong; s += 1) {
      const t = s / samplesAlong;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const ix = sample(gray, x + (centre.x - x) * inGap, y + (centre.y - y) * inGap);
      const ox = sample(gray, x - (centre.x - x) * outGap, y - (centre.y - y) * outGap);
      const g = sample(gradient, x, y);
      if (ix !== null) { innerSum += ix; innerCount += 1; }
      if (ox !== null) { outerSum += ox; outerCount += 1; }
      if (g !== null) gradSum += g;
    }
    if (!innerCount || !outerCount) return null;
    const innerMean = innerSum / innerCount;
    const outerMean = outerSum / outerCount;
    inner.push(innerMean);
    outer.push(outerMean);
    grads.push(gradSum / Math.max(1, innerCount));
    steps[edge] = Math.abs(innerMean - outerMean);
  }
  // a real document boundary shows a step on most edges, not just one
  const sorted = [...steps].sort((a, b) => a - b);
  const step = (sorted[1] + sorted[2]) / 2; // median of the four steps
  const gradRatio = grads.reduce((a, b) => a + b, 0) / 4 / Math.max(1, gradientMean);
  const brighter = inner.reduce((a, b) => a + b, 0) >= outer.reduce((a, b) => a + b, 0);

  // how much of the detected region actually fills the quad: inflated quads score badly
  let inside = 0;
  for (const point of points) {
    if (pointInQuad(point, quad)) inside += 1;
  }
  const fill = Math.min(1, inside / Math.max(1, area));

  const total = step / 25 + Math.min(2, gradRatio) * 0.4 + (brighter ? 0.3 : 0) + fill * fill * 1.6;
  return { step, gradRatio, total, areaRatio, fill };
}

/** Rotated minimum-area rectangle around a convex hull (rotating calipers). */
function minAreaRect(hull) {
  if (!hull || hull.length < 3) return null;
  let best = null;
  for (let i = 0; i < hull.length; i += 1) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
    for (const point of hull) {
      const x = point.x * cos - point.y * sin;
      const y = point.x * sin + point.y * cos;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const area = (maxX - minX) * (maxY - minY);
    if (!best || area < best.area) {
      const back = (x, y) => ({
        x: x * Math.cos(angle) - y * Math.sin(angle),
        y: x * Math.sin(angle) + y * Math.cos(angle),
      });
      best = {
        area,
        corners: [back(minX, minY), back(maxX, minY), back(maxX, maxY), back(minX, maxY)],
      };
    }
  }
  if (best) best.corners = orderQuad(best.corners);
  return best;
}

/** Convex hull (monotone chain). */
function convexHull(points) {
  if (points.length < 3) return points.slice();
  const sorted = [...points].sort((a, b) => (a.x - b.x) || (a.y - b.y));
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const point = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Orders four points as TL, TR, BR, BL. */
function orderQuad(points) {
  const byY = [...points].sort((a, b) => a.y - b.y);
  const top = byY.slice(0, 2).sort((a, b) => a.x - b.x);
  const bottom = byY.slice(2).sort((a, b) => a.x - b.x);
  return [top[0], top[1], bottom[1], bottom[0]];
}

function sobelPlane(plane, width, height) {
  const out = new Float32Array(plane.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const gx = (plane[i - width + 1] + 2 * plane[i + 1] + plane[i + width + 1])
        - (plane[i - width - 1] + 2 * plane[i - 1] + plane[i + width - 1]);
      const gy = (plane[i + width - 1] + 2 * plane[i + width] + plane[i + width + 1])
        - (plane[i - width - 1] + 2 * plane[i - width] + plane[i - width + 1]);
      out[i] = Math.hypot(gx, gy);
    }
  }
  return out;
}

function otsu(plane) {
  const histogram = new Float64Array(256);
  for (let i = 0; i < plane.length; i += 1) histogram[Math.min(255, Math.max(0, Math.round(plane[i])))] += 1;
  const total = plane.length;
  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * histogram[i];
  let sumB = 0; let weightB = 0; let best = 0; let bestVar = -1;
  for (let t = 0; t < 256; t += 1) {
    weightB += histogram[t];
    if (!weightB) continue;
    const weightF = total - weightB;
    if (!weightF) break;
    sumB += t * histogram[t];
    const meanB = sumB / weightB;
    const meanF = (sum - sumB) / weightF;
    const between = weightB * weightF * (meanB - meanF) * (meanB - meanF);
    if (between > bestVar) { bestVar = between; best = t; }
  }
  return best;
}

function boxBlurPlane(plane, width, height, radius) {
  const temp = new Float32Array(plane.length);
  const out = new Float32Array(plane.length);
  const window = radius * 2 + 1;
  for (let y = 0; y < height; y += 1) {
    let sum = 0;
    const row = y * width;
    for (let x = -radius; x <= radius; x += 1) sum += plane[row + Math.min(width - 1, Math.max(0, x))];
    for (let x = 0; x < width; x += 1) {
      temp[row + x] = sum / window;
      sum -= plane[row + Math.min(width - 1, Math.max(0, x - radius))];
      sum += plane[row + Math.min(width - 1, Math.max(0, x + radius + 1))];
    }
  }
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let y = -radius; y <= radius; y += 1) sum += temp[Math.min(height - 1, Math.max(0, y)) * width + x];
    for (let y = 0; y < height; y += 1) {
      out[y * width + x] = sum / window;
      sum -= temp[Math.min(height - 1, Math.max(0, y - radius)) * width + x];
      sum += temp[Math.min(height - 1, Math.max(0, y + radius + 1)) * width + x];
    }
  }
  return out;
}

/** Returns the 4-connected blobs of a mask, biggest first. */
function componentsOf(mask, width, height, minSize) {
  const seen = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);
  const blobs = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    let top = 0;
    stack[top] = start;
    top += 1;
    seen[start] = 1;
    const pixels = [];
    while (top > 0) {
      top -= 1;
      const index = stack[top];
      pixels.push(index);
      const x = index % width;
      const y = (index - x) / width;
      const neighbours = [
        y > 0 ? index - width : -1,
        y < height - 1 ? index + width : -1,
        x > 0 ? index - 1 : -1,
        x < width - 1 ? index + 1 : -1,
      ];
      for (let n = 0; n < 4; n += 1) {
        const next = neighbours[n];
        if (next >= 0 && mask[next] && !seen[next]) {
          seen[next] = 1;
          stack[top] = next;
          top += 1;
        }
      }
    }
    if (pixels.length >= minSize) blobs.push(pixels);
  }
  blobs.sort((a, b) => b.length - a.length);
  return blobs;
}

function erode(mask, width, height) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!mask[index]) continue;
      const ok = (x > 0 && mask[index - 1]) && (x < width - 1 && mask[index + 1])
        && (y > 0 && mask[index - width]) && (y < height - 1 && mask[index + width]);
      if (ok) out[index] = 1;
    }
  }
  return out;
}

function dilate(mask, width, height) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!mask[index]) continue;
      out[index] = 1;
      if (x > 0) out[index - 1] = 1;
      if (x < width - 1) out[index + 1] = 1;
      if (y > 0) out[index - width] = 1;
      if (y < height - 1) out[index + width] = 1;
    }
  }
  return out;
}
