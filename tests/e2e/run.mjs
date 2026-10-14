// End-to-end test of the production build in a real browser (Edge locally, Chrome in CI).
// Run: npm run build && npm run test:e2e   (or E2E_BASE=https://…/kopor/ to test a deployed copy)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const PORT = 4173, BASE = process.env.E2E_BASE || `http://localhost:${PORT}/`;
const channel = process.env.BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : 'chrome');
mkdirSync('screenshots', { recursive: true });

const server = process.env.E2E_BASE ? null : spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
if (server) await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('preview server did not start')), 30000);
  server.stdout.on('data', (d) => { if (String(d).includes(String(PORT))) { clearTimeout(t); resolve(); } });
});

// A recorded sentence plays as the microphone, so the real voice flow can be tested (live mode only).
const LIVE_AI = !!process.env.E2E_LIVE_AI;
const browser = await chromium.launch({ channel, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + new URL('../fixtures/sale.wav', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'en-GB' });
// Force the download path for exported files (desktop Web Share would open a system dialog).
await ctx.addInitScript(() => { Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true }); });
// Default: no cloud AI, so results are repeatable and the offline fallbacks are what gets tested.
if (!LIVE_AI) await ctx.route('**/functions/v1/**', (r) => r.abort('internetdisconnected'));
await ctx.grantPermissions(['microphone']).catch(() => {});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|supabase/i.test(m.text())) errors.push(`console: ${m.text()}`); });
page.on('dialog', (d) => d.accept());
let passed = 0, failed = 0;
const step = async (name, fn) => {
  try { await fn(); passed++; console.log('✓', name); }
  catch (e) { failed++; console.log('✗', name, '\n   ', e.message.split('\n').slice(0, 8).join('\n    ')); await page.screenshot({ path: `screenshots/FAIL-${name.replace(/\W+/g, '-')}.png` }); }
};
const shot = (n) => page.screenshot({ path: `screenshots/${n}.png`, fullPage: true });
// Start every screen visit with no sheet open (a failed step must not leave one blocking the next).
const go = async (hash) => {
  if (await page.locator('[data-vaul-drawer]').count()) { await page.keyboard.press('Escape'); await page.locator('[data-vaul-drawer]').waitFor({ state: 'detached', timeout: 3000 }).catch(() => {}); }
  await page.goto(BASE + '#' + hash); await page.locator('main.content').first().waitFor();
};
// Tap a button inside a sheet the way a person does: close the keyboard, wait for the sheet to stop moving, tap.
const tapInSheet = async (button) => {
  await page.evaluate(() => (document.activeElement instanceof HTMLElement) && document.activeElement.blur());
  let last = '', same = 0;
  for (let i = 0; i < 40 && same < 3; i++) {
    const b = await button.boundingBox(); const k = b ? `${Math.round(b.x)},${Math.round(b.y)}` : '';
    same = k && k === last ? same + 1 : 0; last = k; await page.waitForTimeout(100);
  }
  await button.click({ force: same < 3 });
};
const noOverflow = async () => {
  const [sw, w] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  if (sw > w + 1) throw new Error(`horizontal overflow: ${sw}px > ${w}px`);
};

await step('welcome screen and language switch', async () => {
  await page.goto(BASE);
  await page.getByRole('heading', { name: 'Welcome to Kopor' }).waitFor();
  await page.getByRole('button', { name: 'Krio' }).click();
  await page.getByRole('heading', { name: 'Wɛlkɔm na Kopor' }).waitFor();
  await page.getByRole('button', { name: 'Français' }).click();
  await page.getByRole('heading', { name: 'Bienvenue sur Kopor' }).waitFor();
  await page.getByRole('button', { name: 'English' }).click();
  await noOverflow();
  await shot('01-welcome');
});

await step('open demo business', async () => {
  await page.getByTestId('demo').click();
  await page.getByText("Today's profit").waitFor({ timeout: 90000 });
});

await step('first-use guided tour shows and can be finished', async () => {
  await page.locator('.driver-popover').waitFor({ timeout: 10000 });
  await shot('02-tour');
  for (let i = 0; i < 8 && await page.locator('.driver-popover').count(); i++) {
    await page.locator('.driver-popover-next-btn').click();
    await page.waitForTimeout(250);
  }
  if (await page.locator('.driver-popover').count()) throw new Error('tour did not close');
  await shot('02-home');
});

for (const r of ['/', '/credit', '/cash', '/stock', '/more', '/groups', '/invoices', '/payments', '/reminders', '/assistant', '/health', '/report', '/team', '/audit', '/settings', '/help', '/plan', '/money']) {
  await step(`screen ${r} renders at phone width`, async () => { await go(r); await noOverflow(); });
}

await step('sale with a product reduces stock', async () => {
  await go('/stock');
  const qty = async () => Number(await page.locator('[data-product="Soap bar"] [data-qty]').getAttribute('data-qty'));
  const before = await qty();
  await go('/cash');
  await page.getByTestId('new-sale').click();
  const form = page.getByTestId('sale-form');
  await form.locator('[name=item_name]').fill('Soap bar');
  await form.locator('[name=item_qty]').fill('3');
  await tapInSheet(form.getByRole('button', { name: /Save sale/ }));
  await page.getByText('Sale saved').waitFor();
  await go('/stock');
  await page.waitForFunction((b) => Number(document.querySelector('[data-product="Soap bar"] [data-qty]')?.getAttribute('data-qty')) === b - 3, before, { timeout: 5000 })
    .catch(async () => { throw new Error(`stock ${before} -> ${await qty()}`); });
});

await step('expense', async () => {
  await go('/cash');
  await page.getByTestId('new-expense').click();
  await page.getByTestId('expense-form').locator('[name=amount]').fill('75');
  await tapInSheet(page.getByTestId('expense-form').getByRole('button', { name: /Save expense/ }));
  await page.getByText('Expense saved').waitFor();
  await shot('03-cash');
});

await step('credit entry for a new customer', async () => {
  await go('/credit');
  await page.getByRole('button', { name: /Add entry/ }).click();
  const f = page.getByTestId('new-credit');
  await f.locator('[name=name]').fill('Test Customer');
  await f.locator('[name=amount]').fill('120');
  await f.getByRole('button', { name: 'Save' }).click();
  await page.locator('.balance .big', { hasText: 'Le 120' }).waitFor();
  await shot('04-contact');
});

await step('speak/type entry (offline parser)', async () => {
  await go('/');
  await page.getByRole('button', { name: 'Speak' }).click();
  const f = page.getByTestId('voice-form');
  await f.locator('textarea').fill('Isatu took 2 tins palm oil 360 on credit');
  await f.getByRole('button', { name: /Understand/ }).click();
  // Offline parser: credit entry. Live AI may (correctly) record it as a credit sale to Isatu instead.
  await page.getByTestId('ai-preview').getByText(LIVE_AI ? /Credit given|On credit/ : 'Credit given (they owe you)').first().waitFor();
  await shot('05-voice');
  await page.getByTestId('ai-save').click();
  await page.getByText('Saved').first().waitFor();
});

if (LIVE_AI) await step('microphone: record, transcribe with Whisper, understand', async () => {
  await go('/');
  await page.getByRole('button', { name: 'Speak' }).click();
  const f = page.getByTestId('voice-form');
  await f.getByTestId('mic').click();
  await page.getByText(/Listening/).waitFor();
  await page.waitForTimeout(6000);
  await f.getByTestId('mic').click();
  await page.waitForFunction(() => /rice/i.test(document.querySelector('#voice-text')?.value ?? ''), null, { timeout: 30000 });
  await page.getByTestId('ai-preview').waitFor({ timeout: 30000 });
  await shot('05b-voice-mic');
});

await step('appearance: dark mode, accent colour and large text', async () => {
  await go('/more');
  await page.getByTestId('appearance-row').click();
  await page.getByTestId('appearance').getByRole('radio', { name: /Dark/ }).click();
  await page.locator('[data-accent-option="royal"]').click();
  await page.getByTestId('appearance').getByRole('radio', { name: 'Large text', exact: true }).click();
  const a = await page.evaluate(() => ({ ...document.documentElement.dataset, primary: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() }));
  if (a.theme !== 'dark' || a.accent !== 'royal' || a.text !== 'large' || a.primary !== '#a78bfa') throw new Error(JSON.stringify(a));
  await shot('15-appearance');
  await page.reload(); await page.locator('main.content').first().waitFor();
  const after = await page.evaluate(() => ({ ...document.documentElement.dataset }));
  if (after.accent !== 'royal' || after.text !== 'large') throw new Error('appearance not kept after reload ' + JSON.stringify(after));
  // Back to defaults for the remaining steps.
  await page.getByTestId('appearance-row').click();
  await page.getByTestId('appearance').getByRole('radio', { name: /Auto/ }).click();
  await page.locator('[data-accent-option="emerald"]').click();
  await page.getByTestId('appearance').getByRole('radio', { name: 'Normal text', exact: true }).click();
});

await step('osusu: mark a contribution', async () => {
  await go('/groups');
  await page.locator('.list a.item').first().click();
  await page.locator('.tick').first().waitFor();
  const before = await page.locator('.tick.on').count();
  await page.locator('.tick:not(.on)').first().click();
  await page.waitForFunction((n) => document.querySelectorAll('.tick.on').length === n + 1, before);
  await shot('06-osusu');
});

await step('invoice: create and mark paid', async () => {
  await go('/invoices');
  await page.getByRole('button', { name: /New invoice/ }).click();
  const f = page.getByTestId('invoice-form');
  await f.locator('[name=customer]').fill('Sierra Hotel Ltd');
  await f.locator('[name=item_name]').fill('Rice 50kg bag');
  await f.locator('[name=item_qty]').fill('5');
  await f.getByRole('button', { name: 'Create' }).click();
  await page.getByText('Verification code').waitFor();
  await page.getByText('Le 4,250').first().waitFor();
  await shot('07-invoice');
  await page.getByRole('button', { name: /Mark as paid/ }).click();
  await page.getByText('RECEIPT').first().waitFor();
});

await step('invoice PDF downloads', async () => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('invoice-pdf').click()]);
  if (!dl.suggestedFilename().endsWith('.pdf')) throw new Error(dl.suggestedFilename());
});

await step('tax settings: 15% GST added on top', async () => {
  await go('/settings');
  const f = page.getByTestId('tax-form');
  await f.locator('[name=tax_rate]').fill('15');
  await f.locator('select').selectOption('0');
  await f.getByRole('button', { name: 'Save' }).click();
  await page.getByText('Saved').first().waitFor();
});

await step('sale with discount shows subtotal, tax and total', async () => {
  await go('/cash');
  await page.getByTestId('new-sale').click();
  const form = page.getByTestId('sale-form');
  await form.locator('[name=item_name]').fill('Bread');
  await form.locator('[name=item_qty]').fill('10');
  await form.locator('[name=discount]').fill('10');
  await page.getByTestId('totals').getByText('Le 80.50').waitFor(); // (80 − 10) × 1.15
  await shot('10-sale-tax');
  await tapInSheet(form.getByRole('button', { name: /Save sale/ }));
  await page.getByText('Sale saved').waitFor();
});

await step('return items from a sale', async () => {
  await go('/cash');
  const row = page.locator('.list .item', { hasText: '10 Bread' }).first();
  await row.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await row.click();
  await page.getByRole('button', { name: 'Return items' }).click();
  await page.getByTestId('return-form').locator('[name=return_qty]').first().fill('2');
  await tapInSheet(page.getByRole('button', { name: 'Confirm return' }));
  await page.getByText('Return recorded').waitFor();
});

await step('close the day', async () => {
  await go('/cash');
  await page.getByTestId('close-day').click();
  const f = page.getByTestId('close-form');
  await f.locator('[name=counted]').fill('100');
  await shot('11-close-day');
  await tapInSheet(f.getByRole('button', { name: 'Save day close' }));
  await page.getByText('Day closed').waitFor();
});

await step('money: receive with QR code, then record a debt payment', async () => {
  await go('/');
  await page.getByTestId('home-receive').click();
  const f = page.getByTestId('receive-form');
  await f.locator('[name=from]').fill('Aminata Sesay');
  await f.locator('[name=reason]').fill('Rice');
  await f.getByTestId('show-qr').click();
  await page.waitForFunction(() => document.querySelector('img.qr')?.getAttribute('src')?.startsWith('data:image/png'), null, { timeout: 10000 });
  await shot('12-receive');
  await tapInSheet(f.getByTestId('money-got'));
  const r = page.getByTestId('record-in-form');
  await r.locator('[name=amount]').fill('100');
  if (await r.locator('[name=as]').inputValue() !== 'debt') throw new Error('debtor not preselected');
  await tapInSheet(r.getByRole('button', { name: 'Save' }));
  await page.getByText('Money recorded').first().waitFor();
});

await step('money: send opens the network menu and records the payment', async () => {
  await go('/money');
  await page.getByTestId('money-send').click();
  const f = page.getByTestId('send-form');
  await f.locator('[name=phone]').fill('077123456');
  await f.locator('[name=amount]').fill('30');
  const href = await f.getByTestId('dial').getAttribute('href');
  if (href !== 'tel:*144%23') throw new Error(`dial link ${href}`);
  await shot('13-send');
  await tapInSheet(f.getByTestId('sent-record'));
  await page.getByText('Money recorded').first().waitFor();
});

await step('money: edit mobile money numbers', async () => {
  await go('/money');
  await page.getByRole('button', { name: 'Edit numbers' }).click();
  const f = page.getByTestId('wallets-form');
  await f.locator('[name=wallet_afrimoney]').fill('077 555 111');
  await tapInSheet(f.getByRole('button', { name: 'Save numbers' }));
  await page.getByText('Saved').first().waitFor();
  await page.locator('.list .item', { hasText: '077555111' }).first().waitFor();
});

await step('public pay page from a pay-me link', async () => {
  const data = await page.evaluate(() => {
    const json = JSON.stringify({ b: "Fatu's Provisions", a: 25000, c: 'Le', r: 'Rice', w: [['orange', '076123456']] });
    return btoa(String.fromCharCode(...new TextEncoder().encode(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  });
  await page.goto(BASE + '#/pay/' + data);
  await page.getByRole('heading', { name: "Pay Fatu's Provisions" }).waitFor();
  await page.getByText('076123456').waitFor();
  await page.locator('[data-vaul-drawer]').waitFor({ state: 'detached', timeout: 2000 }).catch(() => { throw new Error('a sheet is still open over the pay page'); });
  await noOverflow();
  await shot('14-pay-page');
});

await step('how-it-works guide on a screen', async () => {
  await go('/credit');
  await page.getByTestId('guide-btn').click();
  const n = await page.getByTestId('guide').locator('li').count();
  if (n !== 4) throw new Error(`guide has ${n} steps`);
});

await step('assistant answers without AI from the records', async () => {
  await go('/assistant');
  await page.getByPlaceholder(/Who owes me the most/i).fill('Who owes me the most?');
  await page.getByPlaceholder(/Who owes me the most/i).press('Enter');
  // Offline: the rule-based answer. Live: any AI answer that names a debtor or says nobody owes.
  await page.locator('.bubble.ai', { hasText: LIVE_AI ? /Aminata|Isatu|Mohamed|owe/i : /owe you the most|Nobody owes you/ }).nth(LIVE_AI ? 1 : 0).waitFor({ timeout: 30000 });
});
await step('Excel export downloads', async () => {
  await go('/settings');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-excel').click()]);
  if (!dl.suggestedFilename().endsWith('.xlsx')) throw new Error(dl.suggestedFilename());
});

await step('plan, help and public legal pages', async () => {
  await go('/plan');
  await page.getByText('Kopor Free').waitFor();
  await shot('12-plan');
  await go('/help');
  await page.getByText('How do I start?').click();
  await page.getByText('Add your products in Stock').waitFor();
  await page.goto(BASE + '#/legal/privacy');
  await page.getByRole('heading', { name: 'Privacy policy' }).waitFor();
  await noOverflow();
});

await step('health report', async () => {
  await go('/health');
  await page.getByText('Record keeping').waitFor();
  await shot('08-health');
  await go('/report');
  await page.getByText('BUSINESS PERFORMANCE REPORT').waitFor();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('report-pdf').click()]);
  if (!dl.suggestedFilename().endsWith('.pdf')) throw new Error(dl.suggestedFilename());
});

await step('PIN lock: set, reload, unlock', async () => {
  await go('/settings');
  const pinForm = page.getByTestId('pin-form');
  await pinForm.locator('input[type=password]').fill('2468');
  await pinForm.getByRole('button').first().click();
  await page.getByText('PIN set').waitFor();
  await page.reload();
  await page.locator('#pin').waitFor();
  await page.locator('#pin').fill('1111');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByText('Wrong PIN').waitFor();
  await page.locator('#pin').fill('2468');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.locator('.topbar').waitFor();
});

await step('dark mode', async () => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await go('/');
  await shot('09-home-dark');
  await page.emulateMedia({ colorScheme: 'light' });
});

await step('works offline after first visit', async () => {
  await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 15000 }).catch(() => page.reload());
  await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 15000 });
  await ctx.setOffline(true);
  await page.reload();
  await page.locator('#pin, .topbar').first().waitFor();
  await ctx.setOffline(false);
});

await browser.close();
server?.kill();
if (errors.length) { console.log('\nJS errors:\n' + errors.join('\n')); failed++; }
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
