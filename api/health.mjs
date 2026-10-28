import { OPS } from "../lib/ops.mjs";

export default async function handler(req, res) {
  const body = JSON.stringify({
    ok: true,
    service: "Eltaranisi Service+ PDF tools",
    ops: Object.keys(OPS),
    count: Object.keys(OPS).length,
    node: process.version,
    time: new Date().toISOString(),
  });
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}
