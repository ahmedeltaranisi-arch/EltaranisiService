import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import path from "node:path";

let registered = false;

function registerFonts() {
  if (registered) return;
  const dir = path.join(process.cwd(), "public", "fonts");
  const fonts = [
    ["Amiri-Regular.ttf", "TaranisiSerif"],
    ["Amiri-Bold.ttf", "TaranisiSerifBold"],
    ["Almarai-Regular.ttf", "TaranisiSans"],
    ["Almarai-Bold.ttf", "TaranisiSansBold"],
  ];
  for (const [file, family] of fonts) {
    try {
      GlobalFonts.registerFromPath(path.join(dir, file), family);
    } catch {
      /* font optional */
    }
  }
  registered = true;
}

/**
 * Renders a single line of (Arabic/mixed) text into a transparent PNG.
 * Canvas performs full Arabic shaping + bidi, so the result is always correct —
 * unlike raw pdf-lib text drawing which cannot shape Arabic glyphs.
 */
export function textToPng(text, {
  size = 48, color = "#16213e", font = "TaranisiSans", bold = false, padding = 8, direction = "rtl", align = "center",
} = {}) {
  registerFonts();
  const family = bold ? (font === "TaranisiSerif" ? "TaranisiSerifBold" : "TaranisiSansBold") : font;
  const probe = createCanvas(10, 10);
  const probeCtx = probe.getContext("2d");
  const cssFont = `${bold ? "700 " : ""}${size}px ${family}`;
  probeCtx.font = cssFont;
  const width = Math.ceil(probeCtx.measureText(text).width) + padding * 2;
  const height = Math.ceil(size * 1.6) + padding * 2;
  const canvas = createCanvas(Math.max(4, width), Math.max(4, height));
  const ctx = canvas.getContext("2d");
  ctx.font = cssFont;
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.textAlign = align;
  ctx.direction = direction;
  const x = align === "center" ? canvas.width / 2 : align === "right" ? canvas.width - padding : padding;
  ctx.fillText(text, x, canvas.height / 2);
  return { png: canvas.toBuffer("image/png"), width: canvas.width, height: canvas.height };
}

export function measureText(text, { size = 48, bold = false, font = "TaranisiSans" } = {}) {
  registerFonts();
  const canvas = createCanvas(10, 10);
  const ctx = canvas.getContext("2d");
  ctx.font = `${bold ? "700 " : ""}${size}px ${font}`;
  return ctx.measureText(text).width;
}
