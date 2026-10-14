// Photographs every screen (light and dark) with the demo business and builds contact sheets for visual review.
// Run after `npm run build`: node tools/screen-review.mjs  -> screenshots/review-light.png, review-dark.png
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const PORT = 4176, BASE = `http://localhost:${PORT}/`;
const ROUTES = ['/', '/credit', '/cash', '/stock', '/more', '/money', '/groups', '/invoices', '/payments', '/reminders', '/assistant', '/health', '/team', '/settings', '/help', '/plan', '/account', '/report', '/audit', '/legal/privacy'];
mkdirSync('screenshots/review', { recursive: true });
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => server.stdout.on('data', (d) => String(d).includes(String(PORT)) && r()));
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
await ctx.route('**/functions/v1/**', (r) => r.abort());
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(BASE);
await page.getByTestId('demo').click();
await page.getByText("Today's profit").waitFor({ timeout: 90000 });
for (let i = 0; i < 8 && await page.locator('.driver-popover').count(); i++) { await page.locator('.driver-popover-next-btn').click(); await page.waitForTimeout(200); }

for (const scheme of ['light', 'dark']) {
  await page.emulateMedia({ colorScheme: scheme });
  for (const r of ROUTES) {
    await page.goto(BASE + '#' + r);
    await page.locator('main.content, .public, h1').first().waitFor().catch(() => {});
    await page.waitForTimeout(350);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    if (overflow) errors.push(`overflow on ${r} (${scheme})`);
    await page.screenshot({ path: `screenshots/review/${scheme}${r.replace(/\//g, '_') || '_home'}.png` });
  }
  // Contact sheet: 5 columns of phone screenshots.
  const imgs = ROUTES.map((r) => `<figure><img src="data:image/png;base64,${readFileSync(`screenshots/review/${scheme}${r.replace(/\//g, '_') || '_home'}.png`).toString('base64')}"><figcaption>${r}</figcaption></figure>`).join('');
  const sheet = await ctx.newPage();
  await sheet.setViewportSize({ width: 1600, height: 900 });
  await sheet.setContent(`<style>body{margin:0;background:#777;font:14px sans-serif;display:grid;grid-template-columns:repeat(5,1fr);gap:8px;padding:8px}
    figure{margin:0}img{width:100%;display:block;border-radius:6px}figcaption{color:#fff;text-align:center}</style>${imgs}`);
  await sheet.screenshot({ path: `screenshots/review-${scheme}.png`, fullPage: true });
  await sheet.close();
}
console.log(errors.length ? 'PROBLEMS:\n' + errors.join('\n') : 'no page errors, no overflow');
await browser.close(); server.kill();
