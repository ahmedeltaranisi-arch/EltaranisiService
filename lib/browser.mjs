import puppeteer from "puppeteer-core";
import { ALMARAI_REGULAR_B64, ALMARAI_BOLD_B64, AMIRI_B64 } from "./fonts-data.mjs";

let chromiumModule = null;
let browserPromise = null;
let lastUse = 0;

async function getChromium() {
  if (!chromiumModule) {
    const mod = await import("@sparticuz/chromium");
    chromiumModule = mod.default || mod;
  }
  return chromiumModule;
}

async function getBrowser() {
  const now = Date.now();
  if (browserPromise) {
    const browser = await browserPromise.catch(() => null);
    if (browser && browser.connected) {
      lastUse = now;
      return browser;
    }
    browserPromise = null;
  }
  browserPromise = (async () => {
    const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.AWS_EXECUTION_ENV);
    let executablePath = process.env.CHROME_PATH || "";
    let args = [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--font-render-hinting=none",
      "--force-color-profile=srgb",
      "--disable-lcd-text",
      "--hide-scrollbars",
      "--disable-extensions",
    ];
    let headless = "shell";

    if (!executablePath) {
      const chromium = await getChromium();
      executablePath = await chromium.executablePath();
      if (!isServerless) args = [...chromium.args, ...args.filter((a) => !chromium.args.includes(a))];
      else args = [...chromium.args, ...args.filter((a) => !chromium.args.includes(a)), "--single-process"];
      headless = chromium.headless || "shell";
    }
    const browser = await puppeteer.launch({
      args,
      defaultViewport: { width: 1280, height: 900, deviceScaleFactor: 1 },
      executablePath,
      headless,
      timeout: 45000,
      protocolTimeout: 60000,
    });
    lastUse = Date.now();
    return browser;
  })();
  try {
    return await browserPromise;
  } catch (error) {
    browserPromise = null;
    throw error;
  }
}

export function fontFaceCss() {
  return `
  @font-face {
    font-family: 'DocSans';
    src: url(data:font/ttf;base64,${ALMARAI_REGULAR_B64}) format('truetype');
    font-weight: 400;
    font-style: normal;
    font-display: block;
  }
  @font-face {
    font-family: 'DocSans';
    src: url(data:font/ttf;base64,${ALMARAI_BOLD_B64}) format('truetype');
    font-weight: 700;
    font-style: normal;
    font-display: block;
  }
  @font-face {
    font-family: 'AmiriEmbed';
    src: url(data:font/ttf;base64,${AMIRI_B64}) format('truetype');
    font-weight: 400;
    font-display: block;
  }
  `;
}

export function wrapHtml({ body, css = "", landscape = false, pageSize = "A4", margin = "14mm", title = "document" }) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
  ${fontFaceCss()}
  @page { size: ${pageSize} ${landscape ? "landscape" : "portrait"}; margin: ${margin}; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body {
    font-family: 'DocSans', 'AmiriEmbed', 'DejaVu Sans', system-ui, sans-serif;
    font-size: 12pt;
    line-height: 1.65;
    color: #111;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  img { max-width: 100%; }
  table { border-collapse: collapse; width: 100%; }
  ${css}
</style></head>
<body>${body}</body></html>`;
}

/** Renders HTML into a PDF buffer using headless Chromium. */
export async function htmlToPdf(html, options = {}) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "load", timeout: 45000 });
    await page.evaluate(async () => {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      const imgs = Array.from(document.images).filter((img) => !img.complete);
      await Promise.all(
        imgs.map((img) => new Promise((resolve) => {
          img.onload = img.onerror = () => resolve();
        })),
      );
    });
    const pdf = await page.pdf({
      ...(options.width && options.height
        ? { width: options.width, height: options.height }
        : { format: options.pageSize || "A4" }),
      landscape: Boolean(options.landscape),
      printBackground: true,
      preferCSSPageSize: true,
      margin: options.margin === false ? undefined : { top: "0", right: "0", bottom: "0", left: "0" },
    });
    return Buffer.from(pdf);
  } finally {
    await page.close().catch(() => {});
  }
}

/** Screenshot HTML (used for slide rendering and thumbnails). */
export async function htmlToImage(html, { width = 1280, height = 720 } = {}) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width, height, deviceScaleFactor: 1.5 });
    await page.setContent(html, { waitUntil: "load", timeout: 45000 });
    await page.evaluate(async () => {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
    });
    return Buffer.from(await page.screenshot({ type: "png", fullPage: false }));
  } finally {
    await page.close().catch(() => {});
  }
}

export async function closeBrowser() {
  if (!browserPromise) return;
  const browser = await browserPromise.catch(() => null);
  browserPromise = null;
  if (browser) await browser.close().catch(() => {});
}
