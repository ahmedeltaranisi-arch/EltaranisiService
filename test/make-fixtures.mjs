import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import pptxgen from "pptxgenjs";
import { Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel, Table, TableRow, TableCell } from "docx";
import { createCanvas } from "@napi-rs/canvas";

const dir = path.join(process.cwd(), "test", "fixtures");
fs.mkdirSync(dir, { recursive: true });

/* ---------- Arabic + English DOCX ---------- */
const doc = new Document({
  creator: "Eltaranisi Test",
  sections: [{
    children: [
      new Paragraph({ alignment: AlignmentType.RIGHT, heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: "تقرير الأداء السنوي 2026", bold: true, rightToLeft: true })] }),
      new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "هذا المستند أُنشئ لاختبار تحويل الملفات من Word إلى PDF مع دعم كامل للغة العربية والاتجاه من اليمين إلى اليسار، ويحتوي على أرقام مثل 12345 ونص إنجليزي Test.", rightToLeft: true })] }),
      new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "البند الأول: الإيرادات الشهرية", bold: true, rightToLeft: true })] }),
      new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "بلغت الإيرادات 450,000 جنيه بزيادة 12% عن العام الماضي، مع تحسن ملحوظ في الربع الرابع.", rightToLeft: true })] }),
      new Paragraph({ children: [new TextRun({ text: "English paragraph for mixed-direction testing. Numbers: 2026, 99.5%, 1,234." })] }),
      new Table({
        width: { size: 100, type: "pct" },
        rows: [
          ["الشهر", "المبيعات", "النمو"].map((t) => new TableCell({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: t, bold: true, rightToLeft: true })] })] })),
          ["يناير", "12,300", "+5%"].map((t) => new TableCell({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: t, rightToLeft: true })] })] })),
          ["فبراير", "9,800", "-2%"].map((t) => new TableCell({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: t, rightToLeft: true })] })] })),
          ["مارس", "15,450", "+8%"].map((t) => new TableCell({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: t, rightToLeft: true })] })] })),
        ].map((cells) => new TableRow({ children: cells })),
      }),
      new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "نهاية التقرير — إدارة الجودة", rightToLeft: true })] }),
    ],
  }],
});
fs.writeFileSync(path.join(dir, "report-ar.docx"), await Packer.toBuffer(doc));

/* ---------- XLSX ---------- */
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
  ["المنتج", "الكمية", "السعر", "الإجمالي"],
  ["قميص قطني", 12, 240.5, 2886],
  ["بنطلون جينز", 7, 310, 2170],
  ["حذاء رياضي", 3, 899.99, 2699.97],
]), "المخزون");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
  ["Department", "Revenue", "Growth"],
  ["Sales", 1000, "12%"],
  ["Operations", 2000, "8%"],
]), "Sheet2");
XLSX.writeFile(wb, path.join(dir, "inventory.xlsx"));

/* ---------- PPTX ---------- */
const ppt = new pptxgen();
ppt.defineLayout({ name: "WIDE", width: 13.333, height: 7.5 });
ppt.layout = "WIDE";
const s1 = ppt.addSlide();
s1.background = { color: "F2F4F8" };
s1.addText("خطة العمل 2026", { x: 0.6, y: 0.5, w: 12, h: 1, fontSize: 40, bold: true, color: "1D2A57", align: "right", rtlMode: true });
s1.addText("نمو مستدام بجودة عالية", { x: 0.6, y: 1.6, w: 12, h: 0.8, fontSize: 20, color: "445566", align: "right", rtlMode: true });
s1.addShape("rect", { x: 0.6, y: 3, w: 5, h: 2, fill: { color: "C7C3FF" } });
s1.addText("الأهداف", { x: 0.8, y: 3.2, w: 4, h: 0.6, fontSize: 24, bold: true, color: "222222" });
const s2 = ppt.addSlide();
s2.addText("شكراً لكم", { x: 0, y: 3, w: 13.333, h: 1, fontSize: 44, align: "center", color: "111111" });
await ppt.writeFile({ fileName: path.join(dir, "plan.pptx") });

/* ---------- images ---------- */
function makeImage(name, w, h, bg, text, color = "#ffffff") {
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  const grd = ctx.createLinearGradient(0, 0, w, h);
  grd.addColorStop(0, bg);
  grd.addColorStop(1, "#1b1035");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = color;
  ctx.font = `bold ${Math.round(w / 12)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(text, w / 2, h / 2);
  return canvas.toBuffer(name.endsWith("png") ? "image/png" : "image/jpeg", 0.9);
}
fs.writeFileSync(path.join(dir, "photo1.jpg"), makeImage("photo1.jpg", 1400, 900, "#3b2f8f", "صورة 1"));
fs.writeFileSync(path.join(dir, "photo2.png"), makeImage("photo2.png", 900, 1200, "#0f766e", "صورة 2"));

/* ---------- text / csv / html ---------- */
fs.writeFileSync(path.join(dir, "notes.txt"), "قائمة المهام الأسبوعية\n=====================\n1. مراجعة تقرير الأداء\n2. تحديث بيانات العملاء\n3. اجتماع الفريق يوم الأحد\n\nEnglish notes: review the quarterly numbers.\n");
fs.writeFileSync(path.join(dir, "data.csv"), "الاسم,القسم,الدرجة\nأحمد الطرنيسي,الهندسة,95\nسارة محمد,التصميم,88\nOmar Ali,Finance,91\n");
fs.writeFileSync(path.join(dir, "page.html"), `<!doctype html><html dir="rtl"><head><meta charset="utf-8"></head><body><h1>صفحة تجريبية</h1><p>هذا نص عربي للتحقق من تحويل HTML إلى PDF.</p><ul><li>عنصر أول</li><li>عنصر ثانٍ</li></ul></body></html>`);

console.log("fixtures ready in", dir);
