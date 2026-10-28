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
export function detectQuad(canvas, { samples = 260 } = {}) {
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
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  // box blur removes sensor noise before thresholding
  const radius = Math.max(2, Math.round(Math.max(width, height) / 60));
  const blurred = boxBlurPlane(gray, width, height, radius);
  const threshold = Math.max(70, otsu(blurred));

  const mask = new Uint8Array(width * height);
  for (let p = 0; p < mask.length; p += 1) mask[p] = blurred[p] >= threshold ? 1 : 0;
  keepLargestComponent(mask, width, height);

  // drop thin protrusions with one opening pass (erode then dilate)
  const opened = dilate(erode(mask, width, height), width, height);
  const blob = new Uint8Array(width * height);
  for (let p = 0; p < blob.length; p += 1) blob[p] = opened[p] && mask[p] ? 1 : 0;

  let count = 0;
  let minX = width; let maxX = 0; let minY = height; let maxY = 0;
  let tl = null; let tr = null; let br = null; let bl = null;
  let tlScore = Infinity; let trScore = -Infinity; let brScore = -Infinity; let blScore = Infinity;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!blob[y * width + x]) continue;
      count += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x + y < tlScore) { tlScore = x + y; tl = { x, y }; }
      if (x - y > trScore) { trScore = x - y; tr = { x, y }; }
      if (x + y > brScore) { brScore = x + y; br = { x, y }; }
      if (x - y < blScore) { blScore = x - y; bl = { x, y }; }
    }
  }
  const area = (maxX - minX + 1) * (maxY - minY + 1);
  if (count < width * height * 0.12 || area < width * height * 0.1) return null;
  if (!tl || !tr || !br || !bl) return null;

  // the extreme points of a rotated rectangle sit slightly inside the real corners,
  // so expand the quad by a few percent around its centre
  const cx = (tl.x + tr.x + br.x + bl.x) / 4;
  const cy = (tl.y + tr.y + br.y + bl.y) / 4;
  const grow = 1.02;
  const norm = [tl, tr, br, bl].map((point) => ({
    x: Math.min(1, Math.max(0, (cx + (point.x - cx) * grow) / width)),
    y: Math.min(1, Math.max(0, (cy + (point.y - cy) * grow) / height)),
  }));
  return norm;
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

/** Keeps only the biggest 4-connected blob of the mask (in place). */
function keepLargestComponent(mask, width, height) {
  const seen = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);
  let bestStart = -1;
  let bestSize = 0;
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    let top = 0;
    stack[top] = start;
    top += 1;
    seen[start] = 1;
    let size = 0;
    while (top > 0) {
      top -= 1;
      const index = stack[top];
      size += 1;
      const x = index % width;
      const y = (index - x) / width;
      const up = y > 0 ? index - width : -1;
      const down = y < height - 1 ? index + width : -1;
      const left = x > 0 ? index - 1 : -1;
      const right = x < width - 1 ? index + 1 : -1;
      const neighbours = [up, down, left, right];
      for (let n = 0; n < 4; n += 1) {
        const next = neighbours[n];
        if (next >= 0 && mask[next] && !seen[next]) {
          seen[next] = 1;
          stack[top] = next;
          top += 1;
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      bestStart = start;
    }
  }
  if (bestStart < 0) {
    mask.fill(0);
    return;
  }
  const out = new Uint8Array(mask.length);
  let top = 0;
  stack[top] = bestStart;
  top += 1;
  out[bestStart] = 1;
  while (top > 0) {
    top -= 1;
    const index = stack[top];
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
      if (next >= 0 && mask[next] && !out[next]) {
        out[next] = 1;
        stack[top] = next;
        top += 1;
      }
    }
  }
  mask.set(out);
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
