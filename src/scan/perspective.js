import { detectDocumentQuad } from "./detect.js";

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
 * Document boundary detection — thin wrapper around the multi-stage engine in
 * `detect.js` (illumination normalisation → masks → Canny → Hough → quad assembly →
 * feature scoring → side optimisation → line refit).
 * Returns normalized corners [TL, TR, BR, BL] plus a confidence value, or null.
 */
export function detectQuad(canvas) {
  const result = detectDocumentQuad(canvas);
  return result.quad || null;
}

/**
 * Same as detectQuad but keeps the confidence + diagnostic info (used by the UI).
 * When the first pass is not confident the photo is re-analysed at a higher
 * resolution — small documents (cards, receipts) and low-contrast scenes often need
 * more pixels before the border lines survive Hough.
 */
export function detectQuadDetailed(canvas) {
  const result = detectDocumentQuad(canvas);
  if (result.quad && result.confidence >= 0.62) return result;
  const retry = detectDocumentQuad(canvas, { maxSide: 640 });
  if (!retry.quad) return result;
  if (!result.quad || retry.confidence > result.confidence + 0.02) {
    return { ...retry, source: `${retry.source}+hi` };
  }
  return result;
}

// legacy (unused) geometry helpers were removed in favour of detect.js
