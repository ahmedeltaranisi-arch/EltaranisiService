import Busboy from "busboy";
import { runOperation, OPS } from "../lib/ops.mjs";

export const config = {
  api: { bodyParser: false, sizeLimit: "25mb" },
  maxDuration: 60,
};

const MIME = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip",
  jpg: "image/jpeg",
  png: "image/png",
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
};

function parseMultipart(req, limitBytes = 24 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const files = [];
    const fields = {};
    let total = 0;
    let settled = false;
    let busboy;
    try {
      busboy = Busboy({ headers: req.headers, limits: { fileSize: 22 * 1024 * 1024, files: 30, fields: 30 } });
    } catch (error) {
      reject(new Error(`تعذر تحليل الطلب: ${error.message}`));
      return;
    }
    busboy.on("file", (name, stream, info) => {
      const chunks = [];
      let size = 0;
      stream.on("data", (chunk) => {
        size += chunk.length;
        total += chunk.length;
        if (total > limitBytes) {
          if (!settled) { settled = true; reject(new Error("حجم الملفات كبير جداً على هذا الطلب (الحد ≈ 22MB)")); }
          stream.unpipe();
          stream.resume();
          return;
        }
        chunks.push(chunk);
      });
      stream.on("end", () => {
        files.push({
          field: name,
          name: info.filename || `${name}.bin`,
          mime: info.mimeType || "application/octet-stream",
          data: Buffer.concat(chunks),
          size,
        });
      });
      stream.on("limit", () => {});
    });
    busboy.on("field", (name, value) => { fields[name] = value; });
    busboy.on("finish", () => {
      if (!settled) {
        settled = true;
        resolve({ files, fields });
      }
    });
    busboy.on("error", (error) => {
      if (!settled) { settled = true; reject(error); }
    });
    req.pipe(busboy);
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "استخدم POST / Use POST" });
    return;
  }

  const startedAt = Date.now();
  try {
    const { files, fields } = await parseMultipart(req);
    const op = fields.op;
    if (!op) {
      sendJson(res, 400, { ok: false, error: "لم يتم تحديد العملية / missing op" });
      return;
    }
    if (!files.length) {
      sendJson(res, 400, { ok: false, error: "لم يتم إرسال أي ملف / no files" });
      return;
    }
    let options = {};
    if (fields.options) {
      try { options = JSON.parse(fields.options); } catch { options = {}; }
    }
    const result = await runOperation(op, files, options);
    const outputs = result.files || [];
    if (!outputs.length) {
      sendJson(res, 200, { ok: true, info: result.info || {}, files: [] });
      return;
    }
    if (outputs.length > 1) {
      sendJson(res, 500, { ok: false, error: "multiple outputs must be zipped inside the operation" });
      return;
    }
    const output = outputs[0];
    const ext = String(output.name).split(".").pop().toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Length": output.data.length,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(output.name)}"; filename*=UTF-8''${encodeURIComponent(output.name)}`,
      "X-Output-Name": encodeURIComponent(output.name),
      "X-Result-Info": encodeURIComponent(JSON.stringify({ ...(result.info || {}), ms: Date.now() - startedAt })),
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "X-Output-Name, X-Result-Info",
    });
    res.end(output.data);
  } catch (error) {
    const message = error?.message || "خطأ غير متوقع";
    const status = /صيغة|غير مدعوم|لا توجد|لم يتم|invalid|Unsupported/i.test(message) ? 422 : 500;
    sendJson(res, status, { ok: false, error: message, ops: Object.keys(OPS).length });
  }
}
