// LIVE test of "point the camera at an item": a product label (no barcode) is turned into an image, chosen through
// the app's camera in the demo business, recognised by the real AI, and must be matched to the right stock item.
// Run after `npm run build`: node tests/cloud/item-live.mjs
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const PORT = 4186, BASE = `http://localhost:${PORT}/`;
const LABEL = `<html><body style="margin:0;display:grid;place-items:center;height:420px;background:#e9e4da">
  <div style="width:300px;height:340px;border-radius:24px;background:linear-gradient(#f4f1e8,#fff);border:6px solid #2b4c9b;display:flex;flex-direction:column;
    align-items:center;justify-content:center;font-family:Arial Black,Arial;color:#2b4c9b;box-shadow:0 10px 30px #0004">
    <div style="font-size:64px;letter-spacing:4px">PEAK</div>
    <div style="font-size:22px;color:#c8102e;font-family:Arial">EVAPORATED MILK</div>
    <div style="margin-top:18px;font-size:20px;font-family:Arial;color:#333">Full cream · 400 g</div>
  </div></body></html>`;

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => server.stdout.on('data', (d) => String(d).includes(String(PORT)) && r()));
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : 'chrome' });
let ok = true;
try {
  const shotPage = await browser.newPage({ viewport: { width: 420, height: 420 } });
  await shotPage.setContent(LABEL);
  const png = await shotPage.screenshot();
  await shotPage.close();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  page.on('response', async (r) => { if (r.url().includes('/functions/v1/ai')) { try { console.log('  server:', JSON.stringify(await r.json()).slice(0, 220)); } catch { /* not JSON */ } } });
  await page.goto(BASE);
  await page.getByTestId('demo').click();
  await page.getByText("Today's profit").waitFor({ timeout: 90000 });
  await page.locator('.driver-popover').waitFor({ timeout: 8000 }).catch(() => {});
  for (let i = 0; i < 8 && await page.locator('.driver-popover').count(); i++) { await page.locator('.driver-popover-next-btn').click(); await page.waitForTimeout(200); }
  await page.getByRole('button', { name: 'Scan', exact: true }).click();
  await page.getByTestId('choose-item').click();
  await page.getByTestId('item-file').setInputFiles({ name: 'item.png', mimeType: 'image/png', buffer: png });
  const r = page.getByTestId('item-result');
  await r.waitFor({ timeout: 60000 });
  const seen = await r.locator('b').first().innerText();
  const matched = await r.locator('select').evaluate((s) => s.selectedOptions[0]?.textContent);
  console.log('Recognised as:', seen, '| matched to:', matched);
  const checks = [['recognised as Peak milk', /peak/i.test(seen) && /milk/i.test(seen)], ['matched to the stock item "Milk tin"', matched === 'Milk tin']];
  for (const [name, pass] of checks) { ok &&= pass; console.log(pass ? '✓' : '✗', name); }
  await page.screenshot({ path: 'screenshots/item-live.png' });
} catch (e) { ok = false; console.log('✗', e.message.split('\n')[0]); }
await browser.close(); server.kill();
console.log(ok ? '\nItem camera live test passed' : '\nItem camera live test FAILED');
process.exit(ok ? 0 : 1);
