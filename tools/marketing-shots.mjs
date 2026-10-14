// Phone-sized marketing screenshots of the demo business for the pitch deck and website.
// Run after `npm run build`: node tools/marketing-shots.mjs
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const PORT = 4174, BASE = `http://localhost:${PORT}/`, OUT = 'docs/img';
mkdirSync(OUT, { recursive: true });
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => server.stdout.on('data', (d) => String(d).includes(String(PORT)) && r()));

const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'light' });
const page = await ctx.newPage();
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });
const go = async (h) => { await page.goto(BASE + '#' + h); await page.locator('main.content').first().waitFor(); await page.waitForTimeout(400); };

await page.goto(BASE);
await page.getByTestId('demo').click();
await page.getByText("Today's profit").waitFor({ timeout: 90000 });
await page.locator('.driver-popover').waitFor();
for (let i = 0; i < 8 && await page.locator('.driver-popover').count(); i++) {
  await page.locator('.driver-popover-next-btn').click();
  await page.waitForTimeout(250);
}
await page.waitForTimeout(300);
await shot('home');

await go('/credit');
await page.locator('#contacts .item').first().click();
await page.locator('.balance').waitFor();
await page.waitForTimeout(300);
await shot('credit');

await go('/groups');
await page.locator('.list a.item').first().click();
await page.locator('.tick').first().waitFor();
await shot('osusu');

await go('/');
await page.getByRole('button', { name: 'Speak' }).click();
await page.getByTestId('voice-form').locator('textarea').fill('Aminata tek 2 tin palm oil 360 on credit');
await page.getByRole('button', { name: /Understand/ }).click();
await page.getByTestId('ai-preview').waitFor();
await shot('voice');

await go('/invoices');
await page.getByRole('button', { name: /New invoice/ }).click();
const f = page.getByTestId('invoice-form');
await f.locator('[name=customer]').fill('Sierra Hotel Ltd');
await f.locator('[name=item_name]').fill('Rice 50kg bag');
await f.locator('[name=item_qty]').fill('5');
await f.getByRole('button', { name: 'Create' }).click();
await page.getByText('Verification code').waitFor();
await page.waitForTimeout(300);
await shot('invoice');

await go('/health');
await shot('health');

await go('/cash');
await page.getByTestId('new-expense').click();
await page.getByTestId('expense-form').locator('[name=amount]').fill('250+120');
await page.waitForTimeout(500);
await shot('keypad');
await page.keyboard.press('Escape');

await page.emulateMedia({ colorScheme: 'dark' });
await go('/');
await shot('home-dark');

await browser.close();
server.kill();
console.log('saved to', OUT);
