// Generates realistic "phone photo of a document" fixtures:
// paper with an Arabic + English text block, a strong shadow gradient,
// warm background, sensor noise, slight rotation/perspective.
import fs from "node:fs";
import path from "node:path";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";

const dir = path.join(process.cwd(), "test", "fixtures", "scan");
fs.mkdirSync(dir, { recursive: true });
GlobalFonts.registerFromPath("public/fonts/Almarai-Regular.ttf", "Almarai");
GlobalFonts.registerFromPath("public/fonts/Almarai-Bold.ttf", "AlmaraiBold");

function noise(ctx, width, height, amount = 12) {
  const image = ctx.getImageData(0, 0, width, height);
  const { data } = image;
  for (let i = 0; i < data.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    data[i] += n;
    data[i + 1] += n;
    data[i + 2] += n;
  }
  ctx.putImageData(image, 0, 0);
}

function shadowGradient(ctx, width, height) {
  const gradient = ctx.createLinearGradient(0, 0, width * 0.85, height);
  gradient.addColorStop(0, "rgba(0,0,0,0.02)");
  gradient.addColorStop(0.35, "rgba(0,0,0,0.28)");
  gradient.addColorStop(0.6, "rgba(0,0,0,0.05)");
  gradient.addColorStop(0.85, "rgba(0,0,0,0.34)");
  gradient.addColorStop(1, "rgba(0,0,0,0.12)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

/** A single "photo" of a page (paper already skewed inside the photo). */
function documentPhoto({ width = 1400, height = 1900, title, lines, skew = 4, fontSize = 34, tint = "#f4efe2" }) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // desk / background
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, "#6b6257");
  bg.addColorStop(1, "#3d3833");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // paper (rotated slightly + perspective feel via scaled draw)
  const padX = width * 0.09;
  const padY = height * 0.07;
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate((skew * Math.PI) / 180);
  ctx.scale(1, 0.98);
  ctx.translate(-width / 2, -height / 2);
  const paperW = width - padX * 2;
  const paperH = height - padY * 2;
  ctx.fillStyle = tint;
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 30;
  ctx.fillRect(padX, padY, paperW, paperH);
  ctx.shadowBlur = 0;

  // text block
  ctx.fillStyle = "#20222c";
  ctx.textAlign = "right";
  ctx.direction = "rtl";
  ctx.font = `bold ${fontSize + 12}px AlmaraiBold`;
  ctx.fillText(title, padX + paperW - 60, padY + 110);
  ctx.font = `${fontSize}px Almarai`;
  let y = padY + 200;
  for (const line of lines) {
    ctx.fillText(line, padX + paperW - 60, y);
    y += Math.round(fontSize * 1.9);
  }
  ctx.direction = "ltr";
  ctx.textAlign = "left";
  ctx.font = `${fontSize - 4}px Almarai`;
  ctx.fillText("Invoice #4821 — Total: 1,250.00 EGP", padX + 60, y + 30);
  ctx.fillText("Date: 2026-10-28  |  Eltaranisi Service+", padX + 60, y + 70);
  ctx.restore();

  shadowGradient(ctx, width, height);
  noise(ctx, width, height, 14);
  return canvas;
}

const page1 = documentPhoto({
  title: "تقرير الأداء السنوي 2026",
  lines: [
    "هذا المستند مصوّر بكاميرا الهاتف لاختبار أداة المسح الضوئي.",
    "القص Perspective وتصحيح الميل ثم إزالة الظلال.",
    "البند الأول: الإيرادات الشهرية بلغت 450,000 جنيه.",
    "البند الثاني: المصروفات التشغيلية 210,000 جنيه.",
    "الخلاصة: صافي الربح 240,000 جنيه بزيادة 12%.",
  ],
});
fs.writeFileSync(path.join(dir, "page-ar.jpg"), page1.toBuffer("image/jpeg", 0.86));

const page2 = documentPhoto({
  width: 1300,
  height: 1750,
  title: "Purchase Order",
  lines: [
    "Vendor: Eltaranisi Trading Company",
    "Item 1 — A4 paper boxes (12) ................ 540.00",
    "Item 2 — Toner cartridges (4) ............... 780.00",
    "Item 3 — Shipping and handling .............. 130.00",
    "Total ....................................... 1,250.00 EGP",
  ],
  skew: -6,
  tint: "#ffffff",
});
fs.writeFileSync(path.join(dir, "page-en.jpg"), page2.toBuffer("image/jpeg", 0.86));

// small receipt, portrait, heavy shadow
const receipt = documentPhoto({
  width: 900,
  height: 1400,
  title: "فاتورة",
  lines: ["قهوة عربية .......... 45", "شاي ................. 25", "حلوى ............... 60", "الإجمالي ........... 130"],
  fontSize: 28,
  skew: 8,
});
fs.writeFileSync(path.join(dir, "receipt.jpg"), receipt.toBuffer("image/jpeg", 0.85));

console.log("scan fixtures written to", dir);
