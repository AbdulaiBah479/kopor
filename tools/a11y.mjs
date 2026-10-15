// Accessibility audit with axe-core (the engine inside Google Lighthouse) on every main screen, light and dark.
// Run after `npm run build`: node tools/a11y.mjs   -> lists every violation with the element it is on.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const PORT = 4178, BASE = `http://localhost:${PORT}/`;
const ROUTES = ['/', '/credit', '/cash', '/stock', '/more', '/money', '/groups', '/invoices', '/reminders', '/assistant', '/health', '/team', '/settings', '/help', '/plan', '/report', '/legal/privacy'];
const axe = readFileSync('node_modules/axe-core/axe.min.js', 'utf8');
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => server.stdout.on('data', (d) => String(d).includes(String(PORT)) && r()));
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : 'chrome') });
// bypassCSP: only so the audit script can be injected (the app's strict policy rightly blocks injected scripts).
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
await ctx.route('**/functions/v1/**', (r) => r.abort());
const page = await ctx.newPage();
const found = new Map();
const audit = async (label) => {
  await page.addScriptTag({ content: axe });
  const res = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'best-practice'] })).violations
    .map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 3).map((n) => `${n.target.join(' ')} :: ${(n.failureSummary ?? '').split('\n').slice(1, 2).join('')}`) })));
  for (const v of res) {
    const k = v.id;
    if (!found.has(k)) found.set(k, { ...v, where: new Set() });
    found.get(k).where.add(label);
    v.nodes.forEach((n) => found.get(k).nodes.includes(n) || found.get(k).nodes.length > 8 || found.get(k).nodes.push(n));
  }
};
await page.goto(BASE);
await page.getByTestId('demo').waitFor();
await audit('welcome');
await page.getByTestId('demo').click();
await page.getByText("Today's profit").waitFor({ timeout: 90000 });
await page.locator('.driver-popover').waitFor({ timeout: 8000 }).catch(() => {});
for (let i = 0; i < 8 && await page.locator('.driver-popover').count(); i++) { await page.locator('.driver-popover-next-btn').click(); await page.waitForTimeout(200); }
for (const scheme of ['light', 'dark']) {
  await page.emulateMedia({ colorScheme: scheme });
  for (const r of ROUTES) {
    await page.goto(BASE + '#' + r);
    await page.locator('main.content, .public, h1').first().waitFor().catch(() => {});
    await page.waitForTimeout(300);
    await audit(`${r} ${scheme}`);
  }
}
if (!found.size) console.log('No accessibility violations');
for (const v of found.values()) console.log(`\n[${v.impact}] ${v.id}: ${v.help}\n  on: ${[...v.where].slice(0, 6).join(', ')}${v.where.size > 6 ? ` (+${v.where.size - 6})` : ''}\n  ${v.nodes.join('\n  ')}`);
await browser.close(); server.kill();
process.exit(found.size ? 1 : 0);
