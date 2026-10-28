/* Document-scanner filters (CamScanner-like) working on RGBA pixel buffers.
   Pure functions so they run in the browser and in Node tests. */

export const FILTERS = [
  { id: "original", label: "Original", arabic: "الأصلية", hint: "الصورة كما هي" },
  { id: "lighten", label: "Lighten", arabic: "إضاءة", hint: "تفتيح الورق مع بقاء التفاصيل" },
  { id: "enhance", label: "Enhance", arabic: "تحسين", hint: "وضوح وتشبع أعلى" },
  { id: "noshadow", label: "No Shadow", arabic: "بلا ظلال", hint: "إزالة الظلال وتوحيد الإضاءة" },
  { id: "bw", label: "B&W", arabic: "أبيض وأسود", hint: "نص حاد بخلفية بيضاء نقية" },
  { id: "eco", label: "Eco", arabic: "اقتصادي", hint: "ألوان أقل وحجم أصغر" },
  { id: "grayscale", label: "Grayscale", arabic: "رمادي", hint: "تدرج رمادي طبيعي" },
];

const clamp255 = (value) => (value < 0 ? 0 : value > 255 ? 255 : value);

/* ------------------------------ primitives ------------------------------ */

/** Separable box blur over `channels` interleaved channels (edge clamped). */
export function boxBlur(src, width, height, radius, channels = 1) {
  const r = Math.max(1, Math.round(radius));
  const window = r * 2 + 1;
  const tmp = new Float32Array(width * height * channels);
  const out = new Float32Array(width * height * channels);

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let c = 0; c < channels; c += 1) {
      let sum = 0;
      for (let x = -r; x <= r; x += 1) {
        sum += src[(row + Math.min(width - 1, Math.max(0, x))) * channels + c];
      }
      for (let x = 0; x < width; x += 1) {
        tmp[(row + x) * channels + c] = sum / window;
        const addX = Math.min(width - 1, x + r + 1);
        const subX = Math.max(0, x - r);
        sum += src[(row + addX) * channels + c] - src[(row + subX) * channels + c];
      }
    }
  }
  for (let x = 0; x < width; x += 1) {
    for (let c = 0; c < channels; c += 1) {
      let sum = 0;
      for (let y = -r; y <= r; y += 1) {
        sum += tmp[(Math.min(height - 1, Math.max(0, y)) * width + x) * channels + c];
      }
      for (let y = 0; y < height; y += 1) {
        out[(y * width + x) * channels + c] = sum / window;
        const addY = Math.min(height - 1, y + r + 1);
        const subY = Math.max(0, y - r);
        sum += tmp[(addY * width + x) * channels + c] - tmp[(subY * width + x) * channels + c];
      }
    }
  }
  return out;
}

const luminance = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

function grayPlane(imageData) {
  const { data, width, height } = imageData;
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    gray[p] = luminance(data[i], data[i + 1], data[i + 2]);
  }
  return gray;
}

function percentileFromHistogram(histogram, total, ratio) {
  let acc = 0;
  const target = total * ratio;
  for (let value = 0; value < 256; value += 1) {
    acc += histogram[value];
    if (acc >= target) return value;
  }
  return 255;
}

function histogramOf(plane) {
  const histogram = new Float64Array(256);
  for (let i = 0; i < plane.length; i += 1) {
    histogram[Math.min(255, Math.max(0, Math.round(plane[i])))] += 1;
  }
  return histogram;
}

/** Otsu's automatic threshold for a luminance plane. */
export function otsuThreshold(plane) {
  const histogram = histogramOf(plane);
  const total = plane.length;
  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * histogram[i];
  let sumB = 0;
  let weightB = 0;
  let best = 0;
  let bestVariance = -1;
  for (let t = 0; t < 256; t += 1) {
    weightB += histogram[t];
    if (!weightB) continue;
    const weightF = total - weightB;
    if (!weightF) break;
    sumB += t * histogram[t];
    const meanB = sumB / weightB;
    const meanF = (sum - sumB) / weightF;
    const variance = weightB * weightF * (meanB - meanF) * (meanB - meanF);
    if (variance > bestVariance) {
      bestVariance = variance;
      best = t;
    }
  }
  return best;
}

/**
 * Flattens uneven lighting: divides the image by a heavily blurred luminance map
 * (the "paper illumination") and then stretches the result to full range.
 * This is what removes phone shadows before any thresholding.
 */
export function normalizeIllumination(imageData, { strength = 1, stretch = true } = {}) {
  const { data, width, height } = imageData;
  const gray = grayPlane(imageData);
  const radius = Math.max(24, Math.round(Math.max(width, height) / 9));
  const light = boxBlur(gray, width, height, radius, 1);
  const smoothLight = boxBlur(light, width, height, Math.round(radius / 2), 1);

  // paper illumination = a high percentile of the light map (ignores the dark desk)
  const sortedLight = Float32Array.from(smoothLight).sort();
  const pageLight = Math.max(60, sortedLight[Math.floor(sortedLight.length * 0.8)] || 200);
  const pageThreshold = pageLight * 0.55; // pixels darker than this are not paper

  const gain = new Float32Array(width * height);
  for (let p = 0; p < gain.length; p += 1) {
    const raw = pageLight / Math.max(28, smoothLight[p]);
    gain[p] = 1 + (Math.min(3.4, Math.max(0.8, raw)) - 1) * strength;
  }

  let low = 0;
  let high = 255;
  if (stretch) {
    // statistics only over paper-ish pixels so a dark background does not bias them
    const histogram = new Float64Array(256);
    let count = 0;
    for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
      if (smoothLight[p] < pageThreshold) continue;
      const value = luminance(data[i] * gain[p], data[i + 1] * gain[p], data[i + 2] * gain[p]);
      histogram[Math.min(255, Math.max(0, Math.round(value)))] += 1;
      count += 1;
    }
    if (count > 1000) {
      low = percentileFromHistogram(histogram, count, 0.02);
      high = percentileFromHistogram(histogram, count, 0.96);
      if (high - low < 40) {
        low = 0;
        high = 255;
      }
    }
  }
  const scale = 255 / Math.max(1, high - low);

  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const g = gain[p];
    for (let c = 0; c < 3; c += 1) {
      const value = data[i + c] * g;
      data[i + c] = clamp255(stretch ? (value - low) * scale : value);
    }
    data[i + 3] = 255;
  }
  return imageData;
}

/** Unsharp mask on RGB (sharpens text edges). */
function unsharpRGB(imageData, amount = 0.6, radius = 2) {
  const { data, width, height } = imageData;
  const channels = 3;
  const rgb = new Float32Array(width * height * channels);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    rgb[p * 3] = data[i];
    rgb[p * 3 + 1] = data[i + 1];
    rgb[p * 3 + 2] = data[i + 2];
  }
  const blurred = boxBlur(rgb, width, height, radius, channels);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    for (let c = 0; c < 3; c += 1) {
      const original = rgb[p * 3 + c];
      data[i + c] = clamp255(original + (original - blurred[p * 3 + c]) * amount);
    }
  }
}

function tone(imageData, lut) {
  const { data } = imageData;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = lut[data[i]];
    data[i + 1] = lut[data[i + 1]];
    data[i + 2] = lut[data[i + 2]];
    data[i + 3] = 255;
  }
}

function gammaLut(gamma, lift = 0) {
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v += 1) {
    lut[v] = clamp255(255 * Math.pow(v / 255, gamma) + lift);
  }
  return lut;
}

/** Writes a single-channel plane back into RGBA (optionally with a tint). */
function writePlane(imageData, plane, tint = null) {
  const { data } = imageData;
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const value = clamp255(plane[p]);
    if (tint) {
      data[i] = clamp255(value + tint[0]);
      data[i + 1] = clamp255(value + tint[1]);
      data[i + 2] = clamp255(value + tint[2]);
    } else {
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
    }
    data[i + 3] = 255;
  }
}

/* -------------------------------- filters -------------------------------- */

function applyOriginal(imageData) {
  return imageData;
}

function applyLighten(imageData) {
  normalizeIllumination(imageData, { strength: 0.55 });
  tone(imageData, gammaLut(0.82, 8));
  return imageData;
}

function applyEnhance(imageData) {
  normalizeIllumination(imageData, { strength: 0.7 });
  const { data } = imageData;
  const contrast = 1.18;
  const saturation = 1.22;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const lum = luminance(r, g, b);
    data[i] = clamp255((lum + (r - lum) * saturation - 128) * contrast + 136);
    data[i + 1] = clamp255((lum + (g - lum) * saturation - 128) * contrast + 136);
    data[i + 2] = clamp255((lum + (b - lum) * saturation - 128) * contrast + 136);
    data[i + 3] = 255;
  }
  unsharpRGB(imageData, 0.7, 2);
  tone(imageData, gammaLut(0.94, 4));
  return imageData;
}

function applyNoShadow(imageData) {
  normalizeIllumination(imageData, { strength: 1 });
  // pull the paper to pure white without crushing the ink (statistics over paper only)
  const { data, width, height } = imageData;
  const plane = grayPlane(imageData);
  const light = boxBlur(plane, width, height, Math.max(24, Math.round(Math.max(width, height) / 9)), 1);
  const sortedLight = Float32Array.from(light).sort();
  const pageLight = Math.max(60, sortedLight[Math.floor(sortedLight.length * 0.8)] || 200);
  const histogram = new Float64Array(256);
  let count = 0;
  for (let p = 0; p < plane.length; p += 1) {
    if (light[p] < pageLight * 0.55) continue;
    histogram[Math.min(255, Math.max(0, Math.round(plane[p])))] += 1;
    count += 1;
  }
  const total = count > 1000 ? count : plane.length;
  const low = count > 1000 ? percentileFromHistogram(histogram, total, 0.02) : 20;
  const high = count > 1000 ? percentileFromHistogram(histogram, total, 0.8) : 220;
  const scale = 255 / Math.max(30, high - low);
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c += 1) {
      const value = (data[i + c] - low) * scale;
      data[i + c] = clamp255(value);
    }
  }
  unsharpRGB(imageData, 0.35, 1);
  return imageData;
}

function applyBW(imageData) {
  normalizeIllumination(imageData, { strength: 1 });
  const plane = grayPlane(imageData);
  let threshold = otsuThreshold(plane);
  threshold = Math.min(215, Math.max(90, threshold - 6));
  const { width, height } = imageData;
  const binary = new Float32Array(plane.length);
  for (let p = 0; p < plane.length; p += 1) binary[p] = plane[p] > threshold ? 255 : 0;

  // despeckle: remove isolated pixels (scanner noise) with a 3×3 vote
  const cleaned = new Float32Array(binary);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const p = y * width + x;
      let white = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (binary[p + dy * width + dx] > 127) white += 1;
        }
      }
      if (binary[p] === 0 && white >= 7) cleaned[p] = 255;
      else if (binary[p] === 255 && white <= 2) cleaned[p] = 0;
    }
  }
  writePlane(imageData, cleaned);
  return imageData;
}

function applyEco(imageData) {
  normalizeIllumination(imageData, { strength: 0.9 });
  const plane = grayPlane(imageData);
  const levels = 4;
  const step = 255 / (levels - 1);
  const { data } = imageData;
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    let value = plane[p];
    value = value < 60 ? value * 0.75 : value; // keep ink dark
    value = Math.round(value / step) * step;
    data[i] = clamp255(value);
    data[i + 1] = clamp255(value);
    data[i + 2] = clamp255(Math.min(255, value + 2));
    data[i + 3] = 255;
  }
  return imageData;
}

function applyGrayscale(imageData) {
  const plane = grayPlane(imageData);
  writePlane(imageData, plane);
  tone(imageData, gammaLut(0.98, 2));
  return imageData;
}

const HANDLERS = {
  original: applyOriginal,
  lighten: applyLighten,
  enhance: applyEnhance,
  noshadow: applyNoShadow,
  bw: applyBW,
  eco: applyEco,
  grayscale: applyGrayscale,
};

export function applyFilter(imageData, filterId = "original") {
  const handler = HANDLERS[filterId] || HANDLERS.original;
  return handler(imageData);
}
