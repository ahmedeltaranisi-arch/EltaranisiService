import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import convertHandler from "./api/convert.mjs";
import healthHandler from "./api/health.mjs";

const ROOT = process.cwd();
const DIST = join(ROOT, "dist");
const PORT = Number(process.env.PORT || 4173);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname === "/api/convert") {
      await convertHandler(req, res);
      return;
    }
    if (url.pathname === "/api/health") {
      await healthHandler(req, res);
      return;
    }
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/") pathname = "/index.html";
    let filePath = resolve(DIST, `.${pathname}`);
    if (!filePath.startsWith(DIST + sep) && filePath !== DIST) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    try {
      const info = await stat(filePath);
      if (info.isDirectory()) filePath = join(filePath, "index.html");
    } catch {
      filePath = join(DIST, "index.html");
    }
    const data = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  } catch (error) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: error.message }));
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Eltaranisi PDF Tools running on http://0.0.0.0:${PORT}`);
});
