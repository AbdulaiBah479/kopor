// End-to-end smoke test in a real browser (uses installed Microsoft Edge).
// Run: node tests/e2e.mjs   (start the server first: node tools/serve.mjs)
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.BASE || 'http://localhost:5173/';
const SHOTS = new URL('../screenshots/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
await mkdir(SHOTS, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('dialog', (d) => d.accept());

const step = async (name, fn) => {
  try { await fn(); console.log('✓', name); }
  catch (e) { errors.push(`${name}: ${e.message.split('\n')[0]}`); console.log('✗', name, e.message.split('\n')[0]); }
};
const shot = (n) => page.screenshot({ path: SHOTS + n + '.png', fullPage: true });

await step('onboarding shows', async () => {
  await page.goto(BASE);
  await page.getByText('Welcome to Kopor').waitFor();
  await shot('01-onboarding');
});

await step('load demo data', async () => {
  await page.getByRole('button', { name: /load a demo business/i }).click();
  await page.getByText("Today's profit").waitFor({ timeout: 60000 });
  await page.waitForTimeout(500);
  await shot('02-home');
});

await step('credit book + contact', async () => {
  await page.goto(BASE + '#/credit');
  await page.getByText('Credit Book').first().waitFor();
  await shot('03-credit');
  await page.locator('#contacts .item').first().click();
  await page.getByRole('button', { name: /you gave/i }).waitFor();
  await page.getByRole('button', { name: /you got/i }).click();
  await page.fill('[data-form=entry] [name=amount]', '50');
  await page.click('[data-form=entry] [type=submit]');
  await page.waitForTimeout(300);
  await shot('04-contact');
});

await step('new sale with stock item', async () => {
  await page.goto(BASE + '#/stock');
  const before = await page.locator('#products .item', { hasText: 'Soap bar' }).locator('.amt').innerText();
  await page.goto(BASE + '#/cash');
  await page.getByRole('button', { name: /sale/i }).first().click();
  await page.fill('[name=item_name]', 'Soap bar');
  await page.fill('[name=item_qty]', '3');
  await page.click('[data-form=newSale] [type=submit]');
  await page.waitForTimeout(300);
  await shot('05-cash');
  await page.goto(BASE + '#/stock');
  const after = await page.locator('#products .item', { hasText: 'Soap bar' }).locator('.amt').innerText();
  if (parseFloat(before) - parseFloat(after) !== 3) throw new Error(`stock not reduced: ${before} -> ${after}`);
  await shot('06-stock');
});

await step('expense', async () => {
  await page.goto(BASE + '#/cash');
  await page.getByRole('button', { name: /expense/i }).first().click();
  await page.fill('[data-form=newExpense] [name=amount]', '75');
  await page.click('[data-form=newExpense] [type=submit]');
  await page.getByText('Expense saved').waitFor();
});

await step('voice / text entry (offline parser)', async () => {
  await page.goto(BASE + '#/home');
  await page.getByRole('button', { name: /speak/i }).first().click();
  await page.fill('[data-form=voice] textarea', 'Isatu took 2 tins palm oil 360 on credit');
  await page.click('[data-form=voice] [type=submit]');
  await page.getByText('Credit given (they owe you)').waitFor();
  await shot('07-voice');
  await page.click('[data-act=aiConfirm]');
  await page.getByText('Saved').first().waitFor();
});

await step('osusu group', async () => {
  await page.goto(BASE + '#/groups');
  await page.locator('.list .item').first().click();
  await page.getByText(/collects/).first().waitFor();
  await page.locator('.tick:not(.on)').first().click();
  await page.waitForTimeout(300);
  await shot('08-osusu');
});

await step('invoice', async () => {
  await page.goto(BASE + '#/invoices');
  await page.getByRole('button', { name: /invoice/i }).click();
  await page.fill('[data-form=newInvoice] [name=customer]', 'Sierra Hotel Ltd');
  await page.fill('[name=item_name]', 'Rice 50kg bag');
  await page.fill('[name=item_qty]', '5');
  await page.click('[data-form=newInvoice] [type=submit]');
  await page.getByText('Verification code').waitFor();
  await shot('09-invoice');
  await page.getByRole('button', { name: /mark as paid/i }).click();
  await page.getByText('RECEIPT').first().waitFor();
});

await step('health + loan report', async () => {
  await page.goto(BASE + '#/health');
  await page.getByText('Record keeping').waitFor();
  await shot('10-health');
  await page.goto(BASE + '#/report');
  await page.getByText('BUSINESS PERFORMANCE REPORT').waitFor();
  await shot('11-report');
});

await step('settings + more', async () => {
  await page.goto(BASE + '#/more');
  await page.goto(BASE + '#/settings');
  await page.getByText('PIN lock').first().waitFor();
});

await step('dark mode render', async () => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(BASE + '#/home');
  await page.waitForTimeout(300);
  await shot('12-home-dark');
  await page.emulateMedia({ colorScheme: 'light' });
});

await step('offline reload (service worker)', async () => {
  await page.goto(BASE + '#/home');
  await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 15000 }).catch(() => page.reload());
  await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 15000 });
  await ctx.setOffline(true);
  await page.reload();
  await page.getByText("Today's profit").waitFor();
  await ctx.setOffline(false);
});

await browser.close();
if (errors.length) { console.log('\nPROBLEMS:\n' + errors.join('\n')); process.exit(1); }
console.log('\nAll checks passed. Screenshots in', SHOTS);
