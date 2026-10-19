// LIVE test of the receipt camera: a supplier receipt (no barcode) is turned into an image, chosen through the app's
// camera button in the demo business, read by the real AI, and must come back as the right lines, matched to stock.
// Run after `npm run build`: node tests/cloud/scan-live.mjs
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const PORT = 4181, BASE = `http://localhost:${PORT}/`;
const RECEIPT = `<html><body style="margin:0;background:#fff;font-family:'Courier New',monospace;width:420px;padding:24px;font-size:20px;color:#222">
  <div style="text-align:center;font-weight:bold;font-size:24px">KISSY ROAD WHOLESALE</div>
  <div style="text-align:center">Kissy Road, Freetown · 076 555 222</div>
  <div style="text-align:center;margin-bottom:12px">CASH RECEIPT 0457</div>
  <table style="width:100%;font-size:20px;border-collapse:collapse">
    <tr><td>RICE 50KG BAG</td><td>2 x 720</td><td style="text-align:right">1,440</td></tr>
    <tr><td>SUGAR 1KG</td><td>10 x 25</td><td style="text-align:right">250</td></tr>
    <tr><td>CANDLES BOX</td><td>3 x 40</td><td style="text-align:right">120</td></tr>
  </table>
  <hr><div style="display:flex;justify-content:space-between;font-weight:bold"><span>TOTAL</span><span>Le 1,810</span></div>
  <div style="text-align:center;margin-top:12px">Thank you</div></body></html>`;

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => server.stdout.on('data', (d) => String(d).includes(String(PORT)) && r()));
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : 'chrome' });
let ok = true;
try {
  // 1) Make the photo.
  const shotPage = await browser.newPage({ viewport: { width: 470, height: 420 } });
  await shotPage.setContent(RECEIPT);
  const png = await shotPage.screenshot();
  await shotPage.close();
  // 2) Use it in the app like a person would.
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  page.on('response', async (r) => { if (r.url().includes('/functions/v1/ai')) { try { console.log('  server:', JSON.stringify(await r.json()).slice(0, 260)); } catch { /* not JSON */ } } });
  await page.goto(BASE);
  await page.getByTestId('demo').click();
  await page.getByText("Today's profit").waitFor({ timeout: 90000 });
  for (let i = 0; i < 8 && await page.locator('.driver-popover').count(); i++) { await page.locator('.driver-popover-next-btn').click(); await page.waitForTimeout(200); }
  await page.getByRole('button', { name: 'Scan', exact: true }).click();
  await page.getByTestId('scan-file').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: png });
  await page.getByTestId('scan-review').waitFor({ timeout: 60000 });
  const rows = await page.getByTestId('scan-row').evaluateAll((els) => els.map((el) => ({
    name: el.querySelector('input')?.value, product: el.querySelector('select')?.selectedOptions[0]?.textContent, qty: el.querySelector('input[type=number]')?.value,
  })));
  console.log('Lines read:', JSON.stringify(rows));
  const mode = await page.getByTestId('scan-review').locator('.seg button.on').innerText();
  console.log('Saved as  :', mode);
  const has = (re, product, qty) => rows.some((r) => re.test(`${r.name}`) && (!product || r.product === product) && Number(r.qty) === qty);
  const checks = [
    ['recognised as goods bought', /Bought/.test(mode)],
    ['rice matched to "Rice 50kg bag", qty 2', has(/rice/i, 'Rice 50kg bag', 2)],
    ['sugar matched to "Sugar 1kg", qty 10', has(/sugar/i, 'Sugar 1kg', 10)],
    ['candles kept as a NEW product, qty 3', has(/candle/i, 'New product', 3)],
  ];
  for (const [name, pass] of checks) { ok &&= pass; console.log(pass ? '✓' : '✗', name); }
  await page.screenshot({ path: 'screenshots/scan-live.png', fullPage: true });
} catch (e) { ok = false; console.log('✗', e.message.split('\n')[0]); }
await browser.close(); server.kill();
console.log(ok ? '\nReceipt camera live test passed' : '\nReceipt camera live test FAILED');
process.exit(ok ? 0 : 1);
