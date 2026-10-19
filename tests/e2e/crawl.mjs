// Crawler: opens every screen of the demo business and taps every (non-destructive) button, like a very fast
// tester, recording crashes, console errors and screens that overflow the phone width.
// Run after `npm run build`: node tests/e2e/crawl.mjs
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const PORT = 4185, BASE = `http://localhost:${PORT}/`;
const ROUTES = ['/', '/credit', '/cash', '/stock', '/more', '/groups', '/invoices', '/payments', '/reminders', '/assistant', '/health',
  '/report', '/team', '/audit', '/settings', '/help', '/plan', '/money', '/pnl', '/appearance', '/account'];
// Never tap these: they delete, sign out, void or leave the page (they have their own tests).
const SKIP = /delete|remove|void|cancel quotation|reset|sign out|log ?out|clear|delete my account|leave|lock|switch user|install|share|whatsapp|sms|call|print|pdf|excel|download|export|choose printer|test receipt|connect monime|upgrade|pay now|camera|scan|take or choose photo|microphone|speak|tap the microphone/i;

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => server.stdout.on('data', (d) => String(d).includes(String(PORT)) && r()));
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.route('**/functions/v1/**', (r) => r.abort('internetdisconnected'));
await ctx.route('**/rest/v1/**', (r) => r.abort('internetdisconnected'));
const page = await ctx.newPage();
const problems = [];
let where = '';
page.on('pageerror', (e) => problems.push(`${where}: CRASH ${e.message.split('\n')[0]}`));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|internetdisconnected|Failed to fetch/i.test(m.text())) problems.push(`${where}: console ${m.text().slice(0, 160)}`); });
page.on('dialog', (d) => d.dismiss());

await page.goto(BASE);
await page.getByTestId('demo').click();
await page.getByText("Today's profit").waitFor({ timeout: 90000 });
await page.locator('.driver-popover').waitFor({ timeout: 8000 }).catch(() => {});
for (let i = 0; i < 8 && await page.locator('.driver-popover').count(); i++) { await page.locator('.driver-popover-next-btn').click(); await page.waitForTimeout(150); }

const closeSheets = async () => {
  for (let i = 0; i < 3 && await page.locator('[data-vaul-drawer]').count(); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(250); }
};
let taps = 0;
for (const route of ROUTES) {
  where = route;
  await page.goto(BASE + '#' + route);
  await page.waitForTimeout(600);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (wide > 1) problems.push(`${route}: page is ${wide}px wider than the phone`);
  const labels = await page.locator('main button:visible, .sticky-actions button:visible, header button:visible').evaluateAll((els) =>
    els.map((e, i) => ({ i, label: (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60) })));
  for (const { i, label } of labels) {
    if (!label || SKIP.test(label)) continue;
    where = `${route} › "${label}"`;
    try {
      await page.goto(BASE + '#' + route);
      await page.waitForTimeout(300);
      const btn = page.locator('main button:visible, .sticky-actions button:visible, header button:visible').nth(i);
      if (!(await btn.count())) continue;
      await btn.click({ timeout: 3000 });
      taps++;
      await page.waitForTimeout(450);
      const w = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (w > 1) problems.push(`${where}: ${w}px wider than the phone`);
      // Inside a sheet, tap its own non-destructive buttons once too (one level deep).
      const inner = await page.locator('[data-vaul-drawer] button:visible').evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60)));
      for (let k = 0; k < Math.min(inner.length, 8); k++) {
        if (!inner[k] || SKIP.test(inner[k]) || /^(save|create|send|close|ok|done|×)$/i.test(inner[k])) continue;
        where = `${route} › "${label}" › "${inner[k]}"`;
        await page.locator('[data-vaul-drawer] button:visible').nth(k).click({ timeout: 2000 }).catch(() => {});
        taps++;
        await page.waitForTimeout(250);
      }
      await closeSheets();
    } catch (e) { problems.push(`${where}: could not tap (${e.message.split('\n')[0].slice(0, 80)})`); await closeSheets(); }
  }
}
console.log(`Tapped ${taps} buttons on ${ROUTES.length} screens.`);
console.log(problems.length ? `\n${problems.length} problems:\n- ${[...new Set(problems)].join('\n- ')}` : 'No problems found.');
await browser.close(); server.kill();
process.exit(problems.length ? 1 : 0);
