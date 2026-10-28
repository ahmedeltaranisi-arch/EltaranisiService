import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const output = join(root, "public");
const assets = ["index.html", "styles.css", "app.js", "favicon.svg"];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const asset of assets) {
  await cp(join(root, asset), join(output, asset));
}
console.log(`Static site built into ${output}`);
