/**
 * Deploys this project to Vercel through the REST API (no CLI login needed).
 * Usage: node scripts/deploy.mjs [production|preview]
 */
import fs from "node:fs";
import path from "node:path";

const TOKEN = process.env.VERCEL_TOKEN;
const TEAM = process.env.VERCEL_TEAM || "team_dV4amhqbtx2eMSaglJTeGv0L";
const PROJECT = process.env.VERCEL_PROJECT || "eltaranisiservice";
const TARGET = process.argv[2] === "preview" ? null : "production";

if (!TOKEN) {
  console.error("VERCEL_TOKEN is required");
  process.exit(1);
}

const ROOT = process.cwd();
const SKIP = new Set(["node_modules", ".git", "dist", "test", ".vercel", ".arena"]);
const SKIP_FILES = new Set(["package-lock.json.bak"]);

function walk(dir, base = "") {
  const entries = [];
  for (const name of fs.readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = path.join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    const stat = fs.statSync(full);
    if (stat.isDirectory()) entries.push(...walk(full, rel));
    else if (!SKIP_FILES.has(name) && stat.size < 4 * 1024 * 1024) entries.push({ full, rel });
  }
  return entries;
}

const totalSize = { bytes: 0 };
const files = walk(ROOT).map(({ full, rel }) => {
  const stat = fs.statSync(full);
  totalSize.bytes += stat.size;
  const buffer = fs.readFileSync(full);
  const isText = /\.(m?js|cjs|json|html|css|svg|md|txt|yml|yaml|ttf)$/i.test(rel)
    ? !rel.endsWith(".ttf")
    : false;
  return {
    file: rel,
    data: isText ? buffer.toString("utf8") : buffer.toString("base64"),
    encoding: isText ? "utf-8" : "base64",
  };
});

console.log(`uploading ${files.length} files (${(totalSize.bytes / 1024 / 1024).toFixed(2)} MB)`);

const response = await fetch(`https://api.vercel.com/v13/deployments?teamId=${TEAM}&forceNew=1`, {
  method: "POST",
  headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    name: PROJECT,
    project: PROJECT,
    ...(TARGET ? { target: TARGET } : {}),
    files,
    projectSettings: {
      framework: null,
      buildCommand: "npm run build",
      outputDirectory: "dist",
      installCommand: "npm install",
      nodeVersion: "22.x",
    },
  }),
});

const deployment = await response.json();
if (!response.ok) {
  console.error("deployment failed:", JSON.stringify(deployment).slice(0, 800));
  process.exit(1);
}
console.log("deployment created:", deployment.id, deployment.url);

let state = deployment.readyState;
let info = deployment;
for (let i = 0; i < 120 && !["READY", "ERROR", "CANCELED"].includes(state); i += 1) {
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const poll = await fetch(`https://api.vercel.com/v13/deployments/${deployment.id}?teamId=${TEAM}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  info = await poll.json();
  state = info.readyState;
  process.stdout.write(`\rstate: ${state}            `);
}
console.log(`\nfinal state: ${state}`);
console.log("url:", `https://${info.url}`);
if (state !== "READY") {
  console.log("error:", JSON.stringify(info.errorMessage || info.errorCode || "").slice(0, 500));
  process.exit(1);
}
fs.writeFileSync(path.join(ROOT, "deployment.json"), JSON.stringify({ id: info.id, url: info.url, state, target: TARGET, at: new Date().toISOString() }, null, 2));
