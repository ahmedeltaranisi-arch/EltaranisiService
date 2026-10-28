import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173';
const exe = await chromium.executablePath();
const browser = await puppeteer.launch({ args: chromium.args, executablePath: exe, headless: 'shell' });
const results = [];
const log = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? '✅' : '❌'} ${name} — ${detail}`); };

const pdfFixture = path.join(process.cwd(), 'test', 'output', 'docx-to-pdf__report-ar.pdf');
const imgFixture = path.join(process.cwd(), 'test', 'fixtures', 'photo1.jpg');

async function openTool(page, title) {
  await page.evaluate((t) => {
    const card = [...document.querySelectorAll('.tool-card')].find((c) => c.textContent.includes(t));
    card.click();
  }, title);
  await page.waitForSelector('#workspace:not([hidden])', { timeout: 5000 });
}

async function upload(page, files) {
  const input = await page.$('#ws-input');
  await input.uploadFile(...files);
  await new Promise((r) => setTimeout(r, 300));
}

async function runAndWait(page) {
  await page.click('#ws-run');
  await page.waitForFunction(() => {
    const result = document.querySelector('#ws-result');
    const error = document.querySelector('#ws-error');
    return (!result.hidden && result.innerHTML.length > 0) || !error.hidden;
  }, { timeout: 60000 });
  const state = await page.evaluate(() => ({
    resultVisible: !document.querySelector('#ws-result').hidden,
    error: document.querySelector('#ws-error').hidden ? null : document.querySelector('#ws-error').textContent,
    linkName: document.querySelector('#ws-result a[download]')?.getAttribute('download') || null,
    meta: document.querySelector('#ws-result .meta')?.textContent || '',
    hasPreview: Boolean(document.querySelector('#ws-result iframe, #ws-result img')),
  }));
  await page.evaluate(() => document.querySelector('#ws-close').click());
  return state;
}

const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 950 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(BASE, { waitUntil: 'networkidle2' });

// 1. status list
await page.waitForFunction(() => document.querySelectorAll('#status-grid .status-item').length > 5, { timeout: 15000 });
const count = await page.evaluate(() => document.querySelectorAll('#status-grid .status-item').length);
log('حالة الأدوات في الواجهة', count >= 20, `${count} أداة ظاهرة`);

// 2. PDF -> Word through the UI
await openTool(page, 'PDF ← Word');
await upload(page, [pdfFixture]);
let state = await runAndWait(page);
log('PDF ← Word من الواجهة', state.resultVisible && !state.error && state.linkName?.endsWith('.docx'), state.error || `${state.linkName}`);

// 3. PDF -> JPG preview
await openTool(page, 'PDF ← JPG');
await upload(page, [pdfFixture]);
state = await runAndWait(page);
log('PDF ← JPG من الواجهة', state.resultVisible && !state.error && state.hasPreview, state.error || state.linkName);

// 4. image -> PDF with preview
await openTool(page, 'صور ← PDF');
await upload(page, [imgFixture]);
state = await runAndWait(page);
log('صور ← PDF من الواجهة', state.resultVisible && !state.error && state.hasPreview, state.error || state.linkName);

// 5. watermark with Arabic text
await openTool(page, 'علامة مائية');
await upload(page, [pdfFixture]);
state = await runAndWait(page);
log('علامة مائية عربية من الواجهة', state.resultVisible && !state.error, state.error || state.linkName);

// 6. self test button
await page.click('#self-test-btn');
await page.waitForFunction(() => !document.querySelector('#toast').hidden, { timeout: 45000 });
const toastText = await page.evaluate(() => document.querySelector('#toast').textContent);
log('زر فحص الأدوات', toastText.includes('✅'), toastText);

log('أخطاء JavaScript', errors.length === 0, errors.join(' | ') || 'لا يوجد');

await browser.close();
const failed = results.filter((r) => !r.ok);
fs.writeFileSync(path.join(process.cwd(), 'test', 'output', 'ui-report.json'), JSON.stringify(results, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} UI checks passed`);
process.exitCode = failed.length ? 1 : 0;
