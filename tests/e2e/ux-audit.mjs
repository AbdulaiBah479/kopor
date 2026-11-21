// UX audit: opens every screen of the demo business on a phone-sized window and reports what makes the app harder
// to use: slow screens, tap targets smaller than 40px, text smaller than 12px, accessibility problems (axe-core),
// and screens wider than the phone. Run after `npm run build`: node tests/e2e/ux-audit.mjs [--dark] [--strict]
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';

const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const PORT = 4187, BASE = `http://localhost:${PORT}/`;
const ROUTES = ['/', '/credit', '/cash', '/stock', '/more', '/groups', '/savings', '/invoices', '/payments', '/reminders', '/assistant', '/health',
  '/report', '/team', '/audit', '/settings', '/help', '/plan', '/money', '/pnl', '/account', '/staff', '/watch', '/gst', '/passport', '/wallet',
  '/agent', '/bills', '/messages', '/layaway'];
const SLOW_MS = 1200, MIN_TAP = 40, MIN_FONT = 12;

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => server.stdout.on('data', (d) => String(d).includes(String(PORT)) && r()));
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 360, height: 760 }, bypassCSP: true });
await ctx.route('**/functions/v1/**', (r) => r.abort('internetdisconnected'));
await ctx.route('**/rest/v1/**', (r) => r.abort('internetdisconnected'));
const page = await ctx.newPage();
// --dark: the same checks in dark mode (the app follows the phone's setting by default).
if (process.argv.includes('--dark')) await page.emulateMedia({ colorScheme: 'dark' });
await page.goto(BASE);
await page.getByTestId('demo').click();
await page.getByText("Today's profit").waitFor({ timeout: 90000 });
await page.locator('.driver-popover').waitFor({ timeout: 8000 }).catch(() => {});
await page.evaluate(() => document.querySelectorAll('.driver-popover, .driver-overlay').forEach((e) => e.remove()));

const issues = [];
for (const route of ROUTES) {
  const t0 = Date.now();
  await page.goto(BASE + '#' + route);
  await page.locator('main').first().waitFor();
  await page.waitForFunction(() => !document.querySelector('.skeleton, [aria-busy="true"]'), null, { timeout: 5000 }).catch(() => {});
  const ms = Date.now() - t0;
  if (ms > SLOW_MS) issues.push(`${route}: slow to open (${ms} ms)`);
  await page.waitForTimeout(300);
  const found = await page.evaluate(({ MIN_TAP, MIN_FONT }) => {
    const out = [];
    const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const name = (e) => (e.getAttribute('aria-label') || e.textContent || e.getAttribute('name') || e.tagName).trim().replace(/\s+/g, ' ').slice(0, 40);
    for (const e of document.querySelectorAll('main button, main a[href], main input:not([type=hidden]), main select, header button, nav a')) {
      if (!vis(e) || e.closest('.sr-only')) continue;
      const r = e.getBoundingClientRect();
      // Inline text links inside a sentence are exempt (WCAG 2.5.8); checkboxes count their label.
      if (e.tagName === 'A' && getComputedStyle(e).display === 'inline') continue;
      // A .stretch link covers its whole list row (the row is the tap target).
      if (e.classList.contains('stretch')) continue;
      const box = e.matches('input[type=checkbox], input[type=radio]') ? (e.closest('label') ?? e).getBoundingClientRect() : r;
      if (box.height < MIN_TAP || box.width < MIN_TAP) out.push(`small tap target ${Math.round(box.width)}×${Math.round(box.height)} "${name(e)}"`);
    }
    const walker = document.createTreeWalker(document.querySelector('main') ?? document.body, NodeFilter.SHOW_TEXT);
    const small = new Set();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || !n.textContent.trim() || !vis(el)) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < MIN_FONT) small.add(`text ${fs}px "${n.textContent.trim().slice(0, 30)}"`);
    }
    out.push(...[...small].slice(0, 5));
    const wide = document.documentElement.scrollWidth - innerWidth;
    if (wide > 1) out.push(`page ${wide}px wider than the phone`);
    return out;
  }, { MIN_TAP, MIN_FONT });
  await page.addScriptTag({ content: axeSource }).catch(() => {});
  const axe = await page.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] }, resultTypes: ['violations'] });
    return r.violations.map((v) => `axe ${v.impact}: ${v.id} (${v.nodes.length}×) ${v.nodes[0]?.target?.join(' ')?.slice(0, 60) ?? ''} ${(v.nodes[0]?.any?.[0]?.message ?? '').slice(0, 140)}`);
  }).catch((e) => [`axe failed: ${e.message.slice(0, 80)}`]);
  for (const f of [...found, ...axe]) issues.push(`${route}: ${f}`);
}
await browser.close(); server.kill();
const uniq = [...new Set(issues)];
console.log(uniq.length ? `${uniq.length} UX issues:\n- ${uniq.join('\n- ')}` : 'No UX issues found.');
process.exit(process.argv.includes('--strict') && uniq.length ? 1 : 0);
