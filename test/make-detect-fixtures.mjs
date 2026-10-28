// Generates synthetic "phone photos" of documents with a KNOWN quad, so detection
// accuracy can be measured numerically (corner error + IoU).
import { createCanvas } from "@napi-rs/canvas";
import fs from "node:fs";
import path from "node:path";

const SET = process.env.SET || "a";
const OUT = path.join(process.cwd(), "test", "fixtures", SET === "b" ? "detect-b" : "detect");
fs.mkdirSync(OUT, { recursive: true });

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function drawBackground(ctx, width, height, type, random) {
  if (type === "wood") {
    ctx.fillStyle = "#6b4a2b";
    ctx.fillRect(0, 0, width, height);
    for (let i = 0; i < 90; i += 1) {
      ctx.strokeStyle = `rgba(${30 + random() * 60},${20 + random() * 40},${10 + random() * 30},${0.25 + random() * 0.5})`;
      ctx.lineWidth = 1 + random() * 5;
      ctx.beginPath();
      const y = random() * height;
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(width * 0.3, y + (random() - 0.5) * 40, width * 0.7, y + (random() - 0.5) * 40, width, y + (random() - 0.5) * 30);
      ctx.stroke();
    }
  } else if (type === "cloth") {
    ctx.fillStyle = "#2f5f9e";
    ctx.fillRect(0, 0, width, height);
    for (let i = 0; i < 5000; i += 1) {
      const r = 1 + random() * 3.4;
      ctx.fillStyle = `rgba(${120 + random() * 120},${140 + random() * 110},${170 + random() * 80},${0.3 + random() * 0.6})`;
      ctx.beginPath();
      ctx.arc(random() * width, random() * height, r, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (type === "desk") {
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#8d8f94");
    gradient.addColorStop(1, "#5f6166");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    for (let i = 0; i < 1400; i += 1) {
      const v = Math.round(70 + random() * 90);
      ctx.fillStyle = `rgba(${v},${v},${v + 6},0.5)`;
      ctx.fillRect(random() * width, random() * height, 1 + random() * 3, 1 + random() * 3);
    }
  } else if (type === "white") {
    // worst case: a paper on a bright desk (almost no contrast)
    ctx.fillStyle = "#e9e9ea";
    ctx.fillRect(0, 0, width, height);
    for (let i = 0; i < 2200; i += 1) {
      const v = Math.round(208 + random() * 40);
      ctx.fillStyle = `rgba(${v},${v},${v},0.6)`;
      ctx.fillRect(random() * width, random() * height, 2 + random() * 5, 1 + random() * 3);
    }
  } else {
    // dark desk
    ctx.fillStyle = "#1d1f26";
    ctx.fillRect(0, 0, width, height);
    for (let i = 0; i < 2600; i += 1) {
      const v = Math.round(20 + random() * 55);
      ctx.fillStyle = `rgba(${v},${v + 4},${v + 10},0.7)`;
      ctx.fillRect(random() * width, random() * height, 1 + random() * 4, 1 + random() * 4);
    }
  }
}

function drawPaper(ctx, quad, { kind, random }) {
  const [tl, tr, br, bl] = quad;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(tl.x, tl.y);
  ctx.lineTo(tr.x, tr.y);
  ctx.lineTo(br.x, br.y);
  ctx.lineTo(bl.x, bl.y);
  ctx.closePath();
  ctx.fillStyle = kind === "card" ? "#eef2fb" : "#fdfcf7";
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 18;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.clip();

  const width = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const height = Math.hypot(bl.x - tl.x, bl.y - tl.y);
  const angle = Math.atan2(tr.y - tl.y, tr.x - tl.x);
  ctx.translate(tl.x, tl.y);
  ctx.rotate(angle);

  if (kind === "card") {
    // coloured strips like a national ID card
    ctx.fillStyle = "#19a7e0";
    ctx.fillRect(width * 0.86, 0, width * 0.14, height);
    ctx.fillStyle = "#19a7e0";
    ctx.fillRect(0, 0, width * 0.06, height * 0.22);
    ctx.fillStyle = "#22303f";
    ctx.font = `${Math.round(height * 0.07)}px sans-serif`;
    const lines = ["وزارة الداخلية", "بطاقة تحقيق الشخصية", "الاسم: محمد أحمد", "الرقم القومي: 29001011234567"];
    lines.forEach((line, index) => {
      ctx.fillText(line, width * 0.55, height * (0.16 + index * 0.16));
    });
  } else {
    ctx.fillStyle = "#20242c";
    ctx.font = `bold ${Math.round(height * 0.055)}px sans-serif`;
    ctx.fillText("تقرير الأداء السنوي 2026", width * 0.42, height * 0.1);
    ctx.font = `${Math.round(height * 0.033)}px sans-serif`;
    for (let i = 0; i < 14; i += 1) {
      const lineWidth = width * (0.25 + random() * 0.55);
      ctx.fillStyle = i % 4 === 0 ? "#3a4250" : "#4a5361";
      ctx.fillRect(width * 0.08, height * (0.18 + i * 0.05), lineWidth, height * 0.014);
    }
    ctx.strokeStyle = "rgba(60,70,90,0.35)";
    ctx.lineWidth = 2;
    ctx.strokeRect(width * 0.05, height * 0.05, width * 0.9, height * 0.9);
  }
  ctx.restore();
}

function addShadow(ctx, width, height, random) {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  const strength = 0.16 + random() * 0.22;
  gradient.addColorStop(0, `rgba(0,0,0,${strength})`);
  gradient.addColorStop(0.45, "rgba(0,0,0,0)");
  gradient.addColorStop(1, `rgba(0,0,0,${strength * 0.8})`);
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = "source-over";
}

function addNoise(canvas, random, amount = 9) {
  const ctx = canvas.getContext("2d");
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < data.length; i += 4) {
    const noise = (random() - 0.5) * amount * 2;
    data[i] = Math.max(0, Math.min(255, data[i] + noise));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
  }
  const out = ctx.createImageData(canvas.width, canvas.height);
  out.data.set(data);
  ctx.putImageData(out, 0, 0);
}

const SCENES = [
  { name: "page-wood-1", width: 900, height: 1200, background: "wood", kind: "page", rotate: -7, perspective: 0.05, scale: 0.74, seed: 11 },
  { name: "page-cloth-2", width: 1000, height: 750, background: "cloth", kind: "page", rotate: 9, perspective: 0.07, scale: 0.8, seed: 22 },
  { name: "page-desk-3", width: 820, height: 1100, background: "desk", kind: "page", rotate: 3, perspective: 0.03, scale: 0.82, seed: 33 },
  { name: "page-dark-4", width: 760, height: 1000, background: "dark", kind: "page", rotate: -13, perspective: 0.09, scale: 0.7, seed: 44 },
  { name: "page-white-5", width: 900, height: 1150, background: "white", kind: "page", rotate: 5, perspective: 0.04, scale: 0.76, seed: 55 },
  { name: "card-cloth-6", width: 1100, height: 800, background: "cloth", kind: "card", rotate: -6, perspective: 0.06, scale: 0.55, seed: 66 },
  { name: "card-wood-7", width: 1000, height: 900, background: "wood", kind: "card", rotate: 12, perspective: 0.08, scale: 0.52, seed: 77 },
  { name: "card-white-8", width: 1050, height: 780, background: "white", kind: "card", rotate: 2, perspective: 0.02, scale: 0.58, seed: 88 },
  { name: "page-landscape-9", width: 1100, height: 800, background: "desk", kind: "page", rotate: -18, perspective: 0.1, scale: 0.66, seed: 99 },
  { name: "page-big-10", width: 800, height: 1050, background: "dark", kind: "page", rotate: 6, perspective: 0.05, scale: 0.88, seed: 101 },
  { name: "card-dark-11", width: 1150, height: 800, background: "dark", kind: "card", rotate: -4, perspective: 0.05, scale: 0.5, seed: 111 },
  { name: "page-cloth-12", width: 950, height: 1250, background: "cloth", kind: "page", rotate: -10, perspective: 0.07, scale: 0.72, seed: 121 },
];

const SET_B = [
  { name: "b-page-wood-1", width: 1080, height: 1440, background: "wood", kind: "page", rotate: 14, perspective: 0.08, scale: 0.7, seed: 901 },
  { name: "b-page-cloth-2", width: 900, height: 1250, background: "cloth", kind: "page", rotate: -16, perspective: 0.1, scale: 0.66, seed: 902 },
  { name: "b-page-desk-3", width: 1200, height: 900, background: "desk", kind: "page", rotate: 7, perspective: 0.06, scale: 0.78, seed: 903 },
  { name: "b-page-dark-4", width: 1000, height: 1000, background: "dark", kind: "page", rotate: -3, perspective: 0.04, scale: 0.8, seed: 904 },
  { name: "b-card-cloth-5", width: 1000, height: 750, background: "cloth", kind: "card", rotate: 20, perspective: 0.1, scale: 0.6, seed: 905 },
  { name: "b-card-wood-6", width: 1200, height: 800, background: "wood", kind: "card", rotate: -9, perspective: 0.07, scale: 0.62, seed: 906 },
  { name: "b-card-desk-7", width: 900, height: 700, background: "desk", kind: "card", rotate: 4, perspective: 0.03, scale: 0.66, seed: 907 },
  { name: "b-page-dark-8", width: 820, height: 1180, background: "dark", kind: "page", rotate: 11, perspective: 0.09, scale: 0.75, seed: 908 },
  { name: "b-page-landscape-9", width: 1250, height: 850, background: "wood", kind: "page", rotate: -22, perspective: 0.12, scale: 0.64, seed: 909 },
  { name: "b-page-cloth-10", width: 1100, height: 800, background: "cloth", kind: "page", rotate: 5, perspective: 0.05, scale: 0.82, seed: 910 },
  { name: "b-card-dark-11", width: 980, height: 720, background: "dark", kind: "card", rotate: -14, perspective: 0.09, scale: 0.58, seed: 911 },
  { name: "b-page-desk-12", width: 900, height: 1300, background: "desk", kind: "page", rotate: -8, perspective: 0.06, scale: 0.85, seed: 912 },
];

const truth = [];
for (const scene of (SET === "b" ? SET_B : SCENES)) {
  const random = mulberry32(scene.seed);
  const canvas = createCanvas(scene.width, scene.height);
  const ctx = canvas.getContext("2d");
  drawBackground(ctx, scene.width, scene.height, scene.background, random);

  // paper rectangle centred, rotated and slightly perspective-skewed
  const ratio = scene.kind === "card" ? 0.62 : 1.38;
  const angle0 = (scene.rotate * Math.PI) / 180;
  const fitWidth = scene.width * scene.scale;
  const fitHeight = scene.height * scene.scale;
  // largest paper (w, w*ratio) whose rotated bounding box still fits inside the frame
  const cos = Math.abs(Math.cos(angle0));
  const sin = Math.abs(Math.sin(angle0));
  const byWidth = fitWidth / (cos + ratio * sin);
  const byHeight = fitHeight / (sin + ratio * cos);
  const paperWidth = Math.min(byWidth, byHeight) * 1.0;
  const paperHeight = paperWidth * ratio;
  const cx = scene.width * (0.5 + (random() - 0.5) * 0.06);
  const cy = scene.height * (0.5 + (random() - 0.5) * 0.06);
  const angle = (scene.rotate * Math.PI) / 180;
  const base = [
    { x: -paperWidth / 2, y: -paperHeight / 2 },
    { x: paperWidth / 2, y: -paperHeight / 2 },
    { x: paperWidth / 2, y: paperHeight / 2 },
    { x: -paperWidth / 2, y: paperHeight / 2 },
  ];
  const jitter = scene.perspective;
  const skew = [
    { x: (random() - 0.5) * jitter, y: (random() - 0.5) * jitter },
    { x: (random() - 0.5) * jitter, y: (random() - 0.5) * jitter },
    { x: (random() - 0.5) * jitter, y: (random() - 0.5) * jitter },
    { x: (random() - 0.5) * jitter, y: (random() - 0.5) * jitter },
  ];
  const quad = base.map((point, index) => {
    const sx = point.x * (1 + skew[index].x);
    const sy = point.y * (1 + skew[index].y);
    return {
      x: cx + sx * Math.cos(angle) - sy * Math.sin(angle),
      y: cy + sx * Math.sin(angle) + sy * Math.cos(angle),
    };
  });

  drawPaper(ctx, quad, { kind: scene.kind, random });
  addShadow(ctx, scene.width, scene.height, random);
  addNoise(canvas, random, 7);

  fs.writeFileSync(path.join(OUT, `${scene.name}.jpg`), canvas.toBuffer("image/jpeg", 0.9));
  truth.push({ name: scene.name, width: scene.width, height: scene.height, quad, meta: scene });
  console.log("wrote", scene.name, `${scene.width}×${scene.height}`, scene.background, scene.kind, `${scene.rotate}°`);
}
fs.writeFileSync(path.join(OUT, "truth.json"), JSON.stringify(truth, null, 2));
console.log(`\n${truth.length} fixtures with ground truth written to ${OUT}`);
