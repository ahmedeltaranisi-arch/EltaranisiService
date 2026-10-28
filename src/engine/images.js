// In-browser image tools (images -> PDF, image format conversion).
import { PDFDocument, canvasesToPdf, bytesOf } from "./pdfops.js";
import JSZip from "jszip";

const PAGE_SIZES = {
  A4: [595.28, 841.89],
  A3: [841.89, 1190.55],
  A5: [419.53, 595.28],
  Letter: [612, 792],
};

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ img, url });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`تعذر قراءة الصورة: ${file.name}`));
    };
    img.src = url;
  });
}

async function imageToCanvas(file, maxSide = 4000) {
  const { img, url } = await loadImage(file);
  let width = img.naturalWidth || img.width;
  let height = img.naturalHeight || img.height;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  width = Math.max(1, Math.round(width * scale));
  height = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  URL.revokeObjectURL(url);
  return canvas;
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("تعذر تصدير الصورة"))), type, quality);
  });
}

export async function imagesToPdf(files, options = {}, onProgress = () => {}) {
  const pageSize = options.pageSize || "fit";
  const orientation = options.orientation || "portrait";
  const margin = Number(options.margin ?? 0);
  const doc = await PDFDocument.create();

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const canvas = await imageToCanvas(file);
    const blob = await canvasBlob(canvas, "image/jpeg", 0.9);
    const image = await doc.embedJpg(new Uint8Array(await blob.arrayBuffer()));

    let pageWidth;
    let pageHeight;
    if (pageSize === "fit") {
      pageWidth = image.width + margin * 2;
      pageHeight = image.height + margin * 2;
    } else {
      const dims = PAGE_SIZES[pageSize] || PAGE_SIZES.A4;
      [pageWidth, pageHeight] = orientation === "landscape" ? [dims[1], dims[0]] : dims;
    }
    const page = doc.addPage([pageWidth, pageHeight]);
    const availableWidth = pageWidth - margin * 2;
    const availableHeight = pageHeight - margin * 2;
    let scale = Math.min(availableWidth / image.width, availableHeight / image.height);
    if (pageSize === "fit") scale = Math.min(scale, 1);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    page.drawImage(image, {
      x: (pageWidth - drawWidth) / 2,
      y: (pageHeight - drawHeight) / 2,
      width: drawWidth,
      height: drawHeight,
    });
    onProgress(Math.round(((index + 1) / files.length) * 100));
  }

  return {
    blob: new Blob([await doc.save()], { type: "application/pdf" }),
    name: files.length === 1 ? `${files[0].name.replace(/\.[^.]+$/, "")}.pdf` : "images.pdf",
    info: { pages: files.length },
  };
}

export async function convertImages(files, options = {}, onProgress = () => {}) {
  const target = options.target === "jpg" ? "jpg" : "png";
  const quality = Math.min(1, Math.max(0.5, Number(options.quality) || 0.92));
  const type = target === "jpg" ? "image/jpeg" : "image/png";
  const outputs = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const canvas = await imageToCanvas(file);
    const blob = await canvasBlob(canvas, type, quality);
    outputs.push({ name: `${file.name.replace(/\.[^.]+$/, "")}.${target}`, blob });
    onProgress(Math.round(((index + 1) / files.length) * 100));
  }

  if (outputs.length === 1) {
    return { blob: outputs[0].blob, name: outputs[0].name, info: {} };
  }
  const zip = new JSZip();
  outputs.forEach((output) => zip.file(output.name, output.blob));
  return {
    blob: await zip.generateAsync({ type: "blob", compression: "DEFLATE" }),
    name: `images-${target}.zip`,
    info: {},
  };
}

export { imageToCanvas, canvasBlob, PDFDocument, canvasesToPdf, bytesOf };
