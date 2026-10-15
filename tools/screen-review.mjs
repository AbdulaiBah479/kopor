// Photographs every screen (light and dark) with the demo business and builds contact sheets for visual review.
// Run after `npm run build`: node tools/screen-review.mjs [width] [height] [label]  -> screenshots/review-<label>-light.png, -dark.png
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const PORT = 4176, BASE = `http://localhost:${PORT}/`;
const [W = 390, H = 844, LABEL = 'phone'] = [Number(process.argv[2]) || undefined, Number(process.argv[3]) || undefined, process.argv[4]];
const ROUTES = ['/', '/credit', '/cash', '/stock', '/more', '/money', '/groups', '/invoices', '/payments', '/reminders', '/assistant', '/health', '/team', '/settings', '/help', '/plan', '/account', '/report', '/audit', '/legal/privacy'];
mkdirSync('screenshots/review', { recursive: true });
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => server.stdout.on('data', (d) => String(d).includes(String(PORT)) && r()));
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : 'chrome' });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: W < 1024, isMobile: W < 768 });
await ctx.route('**/functions/v1/**', (r) => r.abort());
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(BASE);
await page.getByTestId('demo').click();
await page.getByText("Today's profit").waitFor({ timeout: 90000 });
// The first-use tour appears after a short delay: wait for it, then finish it, so it is not caught mid-fade.
await page.locator('.driver-popover').waitFor({ timeout: 8000 }).catch(() => {});
for (let i = 0; i < 8 && await page.locator('.driver-popover').count(); i++) { await page.locator('.driver-popover-next-btn').click(); await page.waitForTimeout(200); }

for (const scheme of ['light', 'dark']) {
  await page.emulateMedia({ colorScheme: scheme });
  for (const r of ROUTES) {
    await page.goto(BASE + '#' + r);
    await page.locator('main.content, .public, h1').first().waitFor().catch(() => {});
    await page.waitForTimeout(350);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    if (overflow) errors.push(`overflow on ${r} (${scheme}, ${W}x${H})`);
    // Text or controls cut off at the right edge, and tap targets that are too small on touch screens.
    const issues = await page.evaluate((touch) => {
      const out = [];
      for (const el of document.querySelectorAll('main.content *, .public *')) {
        const r = el.getBoundingClientRect();
        if (r.width && r.right > innerWidth + 1 && getComputedStyle(el).position !== 'fixed' && !el.closest('.carousel, .seg, .chips, [data-scroll-x]')) out.push('cut: ' + (el.className || el.tagName) + ' ' + (el.textContent || '').trim().slice(0, 30));
      }
      if (touch) for (const el of document.querySelectorAll('main.content button, main.content a')) {
        if (el.matches('.stretch')) continue; // whole row is the tap target
        const r = el.getBoundingClientRect();
        if (r.width && r.height && (r.height < 28 || r.width < 28) && getComputedStyle(el).visibility !== 'hidden') out.push('small target: ' + (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30) + `(${Math.round(r.width)}x${Math.round(r.height)})`);
      }
      return [...new Set(out)].slice(0, 6);
    }, W < 1024);
    for (const i of issues) errors.push(`  ${r} ${scheme} ${W}: ${i}`);
    await page.screenshot({ path: `screenshots/review/${LABEL}-${scheme}${r.replace(/\//g, '_') || '_home'}.png` });
  }
  // Contact sheet: 5 columns of phone screenshots.
  const imgs = ROUTES.map((r) => `<figure><img src="data:image/png;base64,${readFileSync(`screenshots/review/${LABEL}-${scheme}${r.replace(/\//g, '_') || '_home'}.png`).toString('base64')}"><figcaption>${r}</figcaption></figure>`).join('');
  const sheet = await ctx.newPage();
  await sheet.setViewportSize({ width: 1600, height: 900 });
  await sheet.setContent(`<style>body{margin:0;background:#777;font:14px sans-serif;display:grid;grid-template-columns:repeat(${W > 700 ? 3 : 5},1fr);gap:8px;padding:8px}
    figure{margin:0}img{width:100%;display:block;border-radius:6px}figcaption{color:#fff;text-align:center}</style>${imgs}`);
  await sheet.screenshot({ path: `screenshots/review-${LABEL}-${scheme}.png`, fullPage: true });
  await sheet.close();
}
console.log(errors.length ? 'PROBLEMS:\n' + errors.join('\n') : 'no page errors, no overflow');
await browser.close(); server.kill();
