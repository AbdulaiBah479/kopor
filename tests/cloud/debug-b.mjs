// Debug helper: sign in as an existing account on a fresh "phone" and open its business.
// Usage: node tests/cloud/debug-b.mjs <phone> <pin>
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const [phone, pin] = process.argv.slice(2);
const PORT = 4176, BASE = `http://localhost:${PORT}/`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => server.stdout.on('data', (d) => String(d).includes(String(PORT)) && r()));
const browser = await chromium.launch({ channel: 'msedge' });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log(`[${m.type()}]`, m.text().slice(0, 300)); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('response', (r) => { if (r.url().includes('supabase.co') && r.status() >= 400) console.log('[http]', r.status(), r.url().slice(0, 140)); });
const t0 = Date.now();
await page.goto(BASE);
await page.getByRole('button', { name: /I have an account/ }).click();
const f = page.locator('.sheet form');
await f.locator('input[type=tel]').fill(phone);
await f.locator('input[type=password]').fill(pin);
await f.locator('button.btn.primary').click();
await page.getByRole('button', { name: /Fatu's Provisions/ }).click({ timeout: 60000 });
console.log('clicked business after', Math.round((Date.now() - t0) / 1000), 's');
for (let i = 0; i < 18; i++) {
  await page.waitForTimeout(10000);
  const home = await page.getByText("Today's profit").count();
  const toast = await page.locator('[data-sonner-toast]').allTextContents();
  console.log(`${Math.round((Date.now() - t0) / 1000)}s home=${home} toasts=${JSON.stringify(toast)}`);
  if (home) break;
}
await page.screenshot({ path: 'screenshots/debug-phone-b.png' });
await browser.close();
server.kill();
