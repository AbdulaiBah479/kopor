// LIVE test against the real Supabase project in .env.local: two "phones" share one business through the cloud.
// Run after `npm run build`: node tests/cloud/live.mjs   (creates a test account with a made-up 099… number)
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const PORT = 4175, BASE = `http://localhost:${PORT}/`;
const phone = '099' + String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
const pin = '246810';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => server.stdout.on('data', (d) => String(d).includes(String(PORT)) && r()));
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : 'chrome' });
let ok = true;
const pages = [];
const step = async (name, fn) => {
  try { await fn(); console.log('✓', name); }
  catch (e) { ok = false; for (const [i, p] of pages.entries()) { await p.screenshot({ path: `screenshots/live-fail-phone-${i}.png` }).catch(() => {}); console.log('   toasts:', JSON.stringify(await p.locator('[data-sonner-toast]').allTextContents().catch(() => []))); } console.log('✗', name, '\n   ', e.message.split('\n').slice(0, 6).join('\n    ')); throw e; }
};
const newPhone = async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('   [pageerror]', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('   [console]', m.text().slice(0, 300)); });
  page.on('response', (r) => { if (r.url().includes('supabase.co') && r.status() >= 400) console.log('   [http]', r.status(), r.url().slice(0, 120)); });
  pages.push(page);
  return page;
};
const finishTour = async (page) => {
  await page.locator('.driver-popover').waitFor({ timeout: 8000 }).catch(() => {});
  for (let i = 0; i < 8 && await page.locator('.driver-popover').count(); i++) { await page.locator('.driver-popover-next-btn').click(); await page.waitForTimeout(200); }
};
const lastSyncShown = (page) => page.getByText(/Last sync/).first().waitFor({ timeout: 120000 });

try {
  const a = await newPhone();
  await step(`phone A: demo business, create account ${phone}, upload`, async () => {
    await a.goto(BASE);
    await a.getByTestId('demo').click();
    await a.getByText("Today's profit").waitFor({ timeout: 90000 });
    await finishTour(a);
    await a.goto(BASE + '#/account');
    await a.getByRole('button', { name: /Sign in \/ Create account/ }).click();
    await a.getByRole('button', { name: 'Create account' }).first().click();
    const f = a.locator('.sheet form');
    await f.locator('input').nth(0).fill('Kopor Cloud Test');
    await f.locator('input[type=tel]').fill(phone);
    await f.locator('input[type=password]').fill(pin);
    await f.locator('button.btn.primary').click();
    await a.getByTestId('upload-business').click({ timeout: 60000 });
    await a.goto(BASE + '#/account');
    await lastSyncShown(a);
  });

  const profitA = await a.locator('.balance-head .amount').textContent().catch(() => null)
    ?? (await a.goto(BASE), await a.locator('.balance-head .amount').textContent());

  const b = await newPhone();
  await step('phone B: sign in with the same account and download the business', async () => {
    await b.goto(BASE);
    await b.getByRole('button', { name: /I have an account/ }).click();
    const f = b.locator('.sheet form');
    await f.locator('input[type=tel]').fill(phone);
    await f.locator('input[type=password]').fill(pin);
    await f.locator('button.btn.primary').click();
    await b.getByRole('button', { name: /Fatu's Provisions/ }).click({ timeout: 60000 });
    await b.getByText("Today's profit").waitFor({ timeout: 120000 });
    await finishTour(b);
    await b.waitForFunction((p) => document.querySelector('.balance-head .amount')?.textContent === p, profitA, { timeout: 60000 });
  });

  await step('phone B records a sale; phone A receives it', async () => {
    await b.goto(BASE + '#/cash');
    await b.getByTestId('new-sale').click();
    await b.getByTestId('sale-form').locator('[name=amount]').fill('777');
    await b.getByTestId('sale-form').locator('[name=note]').fill('Cloud test sale');
    await b.getByTestId('sale-form').getByRole('button', { name: /Save sale/ }).click();
    await b.goto(BASE + '#/account');
    await b.getByRole('button', { name: 'Sync now' }).click();
    await b.waitForTimeout(4000);
    await a.goto(BASE + '#/account');
    await a.getByRole('button', { name: 'Sync now' }).click();
    await a.waitForTimeout(4000);
    await a.goto(BASE + '#/cash');
    await a.getByText('Cloud test sale').first().waitFor({ timeout: 60000 });
  });
} catch { /* reported above */ }
await browser.close();
server.kill();
console.log(ok ? `\nLIVE CLOUD TEST PASSED (test account phone ${phone}, PIN ${pin})` : '\nLIVE CLOUD TEST FAILED');
process.exit(ok ? 0 : 1);
