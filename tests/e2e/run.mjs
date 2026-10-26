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
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'en-GB',
  geolocation: { latitude: 8.4844, longitude: -13.2344, accuracy: 8 } });   // standing in the shop (Freetown)
// Force the download path for exported files (desktop Web Share would open a system dialog).
await ctx.addInitScript(() => { Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true }); });
// Default: no cloud AI, so results are repeatable and the offline fallbacks are what gets tested.
if (!LIVE_AI) await ctx.route('**/functions/v1/**', (r) => r.abort('internetdisconnected'));
// Reports never go to the real inbox from tests: they take the offline path (kept on the phone).
await ctx.route('**/rest/v1/reports**', (r) => r.abort('internetdisconnected'));
await ctx.grantPermissions(['microphone', 'geolocation']).catch(() => {});
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

for (const r of ['/', '/credit', '/cash', '/stock', '/more', '/groups', '/savings', '/wallet', '/invoices', '/payments', '/reminders', '/assistant', '/health', '/report', '/team', '/audit', '/settings', '/help', '/plan', '/money', '/pnl', '/staff', '/gst', '/watch', '/passport']) {
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

await step('tap-to-sell: product tiles fill the sale, payment by tap', async () => {
  await go('/cash');
  await page.getByTestId('new-sale').click();
  const form = page.getByTestId('sale-form');
  const tile = form.locator('.pos-tile[data-product="Soap bar"]');
  await tile.click();
  await tile.click();
  await tile.locator('.pos-badge', { hasText: '2' }).waitFor();
  await form.getByTestId('method-chips').getByRole('radio', { name: 'Orange Money' }).click();
  await shot('03b-tap-to-sell');
  const save = form.getByRole('button', { name: /Save sale · Le 24/ });   // 2 × Le 12
  await tapInSheet(save);
  await page.getByText('Sale saved').first().waitFor();
  await page.locator('.list .item', { hasText: '2 Soap bar' }).filter({ hasText: 'Orange Money' }).first().waitFor();
});

await step('scan a supplier receipt (no barcode): stock goes up, new product created', async () => {
  // Stand-in for the AI reading the photo, so this runs offline and gives the same answer every time.
  const reading = { kind: 'purchase', vendor: 'Kissy Wholesale', date: '', total: 1700 + 300, category: 'stock',
    items: [{ name: 'Rice 50kg bag', qty: 2, price: 850 }, { name: 'Candles box', qty: 3, price: 100 }] };
  await page.route('**/functions/v1/ai', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: JSON.stringify(reading), provider: 'test' }) }));
  const rice = async () => Number(await page.locator('[data-product="Rice 50kg bag"] [data-qty]').getAttribute('data-qty'));
  let before = 0;
  try {
  await go('/stock');
  before = await rice();
  await go('/');
  await page.getByRole('button', { name: 'Scan', exact: true }).click();
  await page.getByTestId('choose-receipt').click();
  // A tiny white PNG stands in for the camera photo.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');
  await page.getByTestId('scan-file').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: png });
  // Builds without the Kopor cloud (e.g. CI) read on the phone instead (next step); the live test
  // (tests/cloud/scan-live.mjs) covers the real AI reading.
  await Promise.race([page.getByTestId('scan-review').waitFor({ timeout: 60000 }), page.getByTestId('scan-here').waitFor({ timeout: 60000 })]);
  if (await page.getByTestId('scan-here').count()) { console.log('   (no cloud in this build: read on the phone, see next step)'); await page.keyboard.press('Escape'); return; }
  if ((await page.getByTestId('scan-row').count()) !== 2) throw new Error('expected 2 lines');
  await page.getByText('1 new products will be added').waitFor();
  await shot('05b-scan-receipt');
  await tapInSheet(page.getByTestId('scan-save'));
  await page.getByText('Stock added and expense recorded').waitFor();
  } finally { await page.unroute('**/functions/v1/ai'); }
  await go('/stock');
  await page.waitForFunction((b) => Number(document.querySelector('[data-product="Rice 50kg bag"] [data-qty]')?.getAttribute('data-qty')) === b + 2, before, { timeout: 5000 })
    .catch(async () => { throw new Error(`rice ${before} -> ${await rice()}`); });
  await page.locator('[data-product="Candles box"]').waitFor();
});

await step('no AI: the phone reads a printed receipt itself (Tesseract), then again with no internet', async () => {
  // Draw a printed receipt, as a phone camera would see it.
  const dataUrl = await page.evaluate(() => {
    const lines = ['KISSY ROAD WHOLESALE', 'CASH RECEIPT', 'RICE 50KG BAG   2 x 720   1,440', 'SUGAR 1KG   10 x 25   250', 'CANDLES BOX   3 x 40   120', 'TOTAL   1,810'];
    const c = document.createElement('canvas'); c.width = 900; c.height = 80 + lines.length * 70;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#111'; g.font = '40px monospace';
    lines.forEach((l, i) => g.fillText(l, 40, 80 + i * 70));
    return c.toDataURL('image/png');
  });
  const png = Buffer.from(dataUrl.split(',')[1], 'base64');
  const read = async () => {
    await go('/');
    await page.getByRole('button', { name: 'Scan', exact: true }).click();
    await page.getByTestId('choose-receipt').click();
    await page.getByTestId('scan-file').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: png });
    await page.getByTestId('scan-here').waitFor({ timeout: 120000 });
    await page.getByTestId('scan-review').waitFor({ timeout: 5000 });
    const names = await page.getByTestId('scan-row').locator('input[aria-label=Item]').evaluateAll((els) => els.map((e) => e.value));
    if (names.length !== 3 || !/rice/i.test(names[0]) || !/candles/i.test(names[2])) throw new Error('read: ' + JSON.stringify(names));
    await page.keyboard.press('Escape');
  };
  await page.route('**/functions/v1/ai', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"busy"}' }));
  try {
    await read();                    // the AI is down: falls back to the phone
    await ctx.setOffline(true);
    try { await read(); } finally { await ctx.setOffline(false); } // no internet at all: the reader was kept
  } finally { await page.unroute('**/functions/v1/ai'); }
});

await step('point the camera at an item: recognised, matched, added to stock, View opens Stock', async () => {
  const guess = { name: 'Peak Milk tin', brand: 'Peak', size: '', barcode: '', match: 'Milk tin', confidence: 0.9 };
  await page.route('**/functions/v1/ai', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: JSON.stringify(guess), provider: 'test' }) }));
  const milk = async () => Number(await page.locator('[data-product="Milk tin"] [data-qty]').getAttribute('data-qty'));
  let before = 0;
  try {
    await go('/stock');
    before = await milk();
    await go('/');
    await page.getByRole('button', { name: 'Scan', exact: true }).click();
    await page.getByTestId('choose-item').click();
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');
    await page.getByTestId('item-file').setInputFiles({ name: 'item.png', mimeType: 'image/png', buffer: png });
    const noCloud = page.getByText('This needs an internet connection');
    await Promise.race([page.getByTestId('item-result').waitFor({ timeout: 20000 }), noCloud.first().waitFor({ timeout: 20000 })]);
    if (await noCloud.count()) { console.log('   (no cloud in this build: checked the message instead)'); return; }
    const r = page.getByTestId('item-result');
    if ((await r.locator('select').inputValue()) === '') throw new Error('not matched to Milk tin');
    await r.locator('input[type=number]').fill('2');
    await shot('05c-item-scan');
    await r.getByTestId('item-stock').click();
    await page.locator('[data-sonner-toast]', { hasText: '2 Milk tin added to stock' }).getByRole('button', { name: 'View' }).click();
  } finally { await page.unroute('**/functions/v1/ai'); }
  if (!before) return;
  await page.waitForFunction((b) => Number(document.querySelector('[data-product="Milk tin"] [data-qty]')?.getAttribute('data-qty')) === b + 2, before, { timeout: 5000 })
    .catch(async () => { throw new Error(`milk ${before} -> ${await milk()}`); });
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
  await page.getByTestId('ai-save').getByText(LIVE_AI ? /Credit|Sale/ : 'Credit (they owe)').first().waitFor();   // the AI's suggestion is highlighted
  await shot('05-voice');
  await page.getByTestId('ai-save').click();
  await page.getByText('Saved').first().waitFor();
});

await step('bought stock by voice/typing: stock goes up, "View" opens Stock', async () => {
  await go('/stock');
  const rice = async () => Number(await page.locator('[data-product="Rice 50kg bag"] [data-qty]').getAttribute('data-qty'));
  const before = await rice();
  await go('/');
  await page.getByRole('button', { name: 'Speak' }).click();
  const f = page.getByTestId('voice-form');
  await f.locator('textarea').fill('Bought 5 bags rice 3500');
  await f.getByRole('button', { name: /Understand/ }).click();
  await page.getByTestId('ai-save').getByText('Stock bought').waitFor();
  // Let earlier "Saved" popups disappear, so the View tapped below is this entry's.
  await page.waitForFunction(() => !document.querySelector('[data-sonner-toast]'), null, { timeout: 15000 });
  await page.getByTestId('ai-save').click();
  await page.locator('[data-sonner-toast]').getByRole('button', { name: 'View' }).click();
  await page.waitForFunction(() => location.hash.startsWith('#/stock'));
  await page.waitForFunction((b) => Number(document.querySelector('[data-product="Rice 50kg bag"] [data-qty]')?.getAttribute('data-qty')) === b + 5, before, { timeout: 5000 })
    .catch(async () => { throw new Error(`rice ${before} -> ${await rice()}`); });
});

await step('voice/typing "Save as": the user picks where it goes, one tap records it there', async () => {
  const milk = async () => Number(await page.locator('[data-product="Milk tin"] [data-qty]').getAttribute('data-qty'));
  await go('/stock');
  const before = await milk();
  const enter = async (text) => {
    await go('/');
    await page.getByRole('button', { name: 'Speak' }).click();
    const f = page.getByTestId('voice-form');
    await f.locator('textarea').fill(text);
    await f.getByRole('button', { name: /Understand/ }).click();
    await page.getByTestId('ai-preview').waitFor();
  };
  await enter('2 milk tin 50');
  await page.getByTestId('ai-preview').getByText('Save as:').waitFor();
  await page.waitForTimeout(500);
  await page.getByTestId('ai-preview').screenshot({ path: 'screenshots/05d-save-as.png' });
  await page.waitForFunction(() => !document.querySelector('[data-sonner-toast]'), null, { timeout: 15000 });
  await page.getByTestId('ai-preview').locator('[data-action=purchase]').click();      // "Stock bought"
  await page.locator('[data-sonner-toast]').getByRole('button', { name: 'View' }).click();
  await page.waitForFunction((b) => Number(document.querySelector('[data-product="Milk tin"] [data-qty]')?.getAttribute('data-qty')) === b + 2, before, { timeout: 5000 })
    .catch(async () => { throw new Error(`milk ${before} -> ${await milk()}`); });
  await enter('2 milk tin 50');
  await page.getByTestId('ai-preview').locator('[data-action=sale]').click();          // the same words, saved as a sale
  await go('/cash');
  await page.locator('.list .item', { hasText: '2 Milk tin' }).first().waitFor();
});

await step('team: add staff; a second branch on the free plan explains the limit', async () => {
  await go('/team');
  await page.getByRole('button', { name: 'Add staff' }).click();
  const form = page.locator('form.form').last();
  await form.locator('input').first().fill('Kadiatu Kamara');
  await tapInSheet(form.getByRole('button', { name: 'Save' }));
  await page.locator('.item', { hasText: 'Kadiatu Kamara' }).waitFor();
  await page.getByRole('button', { name: 'Add branch' }).click();
  const b = page.locator('form.form').last();
  await b.locator('input').first().fill('Lumley shop');
  await tapInSheet(b.getByRole('button', { name: 'Save' }));
  await page.getByText('The free plan includes 1 branch').waitFor();
});

await step('staff: tap in, mark absent, set pay, give an advance, pay the salary (a Cash book expense)', async () => {
  await go('/staff');
  // The owner taps in for themselves.
  const tap = page.getByTestId('tap-card');
  await tap.getByTestId('tap-in').click();
  await tap.getByTestId('tap-out').waitFor();
  // Mark Kadiatu (added in the team step) absent today.
  const kadi = page.getByTestId('register').locator('[data-member="Kadiatu Kamara"]');
  await kadi.locator('[data-status=absent]').click();
  await kadi.getByText('Absent', { exact: true }).first().waitFor();
  await noOverflow();
  await shot('11-staff-today');
  // Pay: Le 2,700 a month, advance Le 500, then pay what is left.
  await page.getByRole('tab', { name: 'Pay' }).click();
  const card = page.getByTestId('pay-card').filter({ has: page.locator('b', { hasText: 'Kadiatu Kamara' }) });
  await card.getByTestId('set-pay').click();
  const terms = page.getByTestId('terms-form');
  await terms.locator('[name=amount]').fill('2700');
  await tapInSheet(terms.getByRole('button', { name: 'Save' }));
  await card.getByTestId('give-advance').click();
  const adv = page.getByTestId('pay-form');
  await adv.locator('[name=amount]').fill('500');
  await tapInSheet(adv.getByRole('button', { name: 'Save' }));
  await page.waitForFunction(() => !document.querySelector('[data-testid=pay-form]'));
  await card.getByTestId('pay-salary').click();
  await tapInSheet(page.getByTestId('pay-form').getByRole('button', { name: 'Save' }));  // the amount still owed is filled in
  await page.waitForFunction(() => !document.querySelector('[data-testid=pay-form]'));
  const balance = await card.getByTestId('pay-balance').textContent();
  if (!/^\D*0(\.00)?$/.test(balance.trim())) throw new Error('still owed: ' + balance);
  await shot('11b-staff-pay');
  await go('/cash');
  await page.getByText(/Staff advance/).first().waitFor();
  await page.getByText(/Staff salary/).first().waitFor();
  if (await page.getByText(/Kadiatu Kamara/).count()) throw new Error('the cash book names whose pay it is');
});

await step('location: save the shop exactly, switch on live location, staff agree, managers see who is at work', async () => {
  await go('/staff');
  await page.getByTestId('set-shop').click();
  await page.getByText('Shop location saved').waitFor();
  await page.getByTestId('shop-location').getByText(/set/i).first().waitFor();
  await page.getByTestId('live-switch').check();
  const ask = page.getByTestId('live-consent');                // the owner is tapped in, so their own phone asks too
  await ask.waitFor();
  await ask.getByTestId('live-agree').click();
  await page.getByTestId('live-status').waitFor();
  const map = page.getByTestId('live-map');
  await map.waitFor();
  await map.locator('[data-member]').first().waitFor();          // everyone tapped in is listed
  await noOverflow();
  await shot('11c-live-location');
  await page.getByTestId('live-switch').uncheck();
  await map.waitFor({ state: 'detached' });
});

await step('import: a customer spreadsheet (with what they owe) and a stock list', async () => {
  await go('/credit');
  await page.getByTestId('import-customers').click();
  const csv = 'Name,Phone,Owes\nHaja Mansaray,076 900 111,"1,250"\nAlimamy Turay,,300\n';
  await page.getByTestId('import-file').setInputFiles({ name: 'customers.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  const review = page.getByTestId('import-review');
  await review.getByText('Haja Mansaray').waitFor();
  await tapInSheet(review.getByTestId('import-save'));
  await page.getByText('2 customers added').waitFor();
  await page.locator('#contacts .item', { hasText: 'Haja Mansaray' }).waitFor();
  await go('/stock');
  await page.getByTestId('import-products').click();
  const stock = 'Item,Selling price,Cost price,Stock,Unit\nGari 1kg,15,11,30,bag\nTomato paste,8,6,24,tin\n';
  await page.getByTestId('import-file').setInputFiles({ name: 'stock.csv', mimeType: 'text/csv', buffer: Buffer.from(stock) });
  await page.getByTestId('import-review').getByText('Gari 1kg').waitFor();
  await tapInSheet(page.getByTestId('import-review').getByTestId('import-save'));
  await page.getByText('2 products added').waitFor();
  const qty = await page.locator('[data-product="Gari 1kg"] [data-qty]').getAttribute('data-qty');
  if (qty !== '30') throw new Error('Gari stock ' + qty);
});

await step('cartons and expiry: sell a carton (stock down by 12), restock with an expiry date, see the warning', async () => {
  await go('/stock');
  await page.locator('.fab').click();
  const form = page.getByTestId('product-form');
  await form.locator('[name=name]').fill('Malta Guinness');
  await form.locator('[name=price]').fill('15');
  await form.locator('[name=qty]').fill('48');
  await form.locator('summary').click();
  await form.locator('[name=pack_size]').fill('12');
  await form.locator('[name=pack_price]').fill('170');
  await tapInSheet(form.getByRole('button', { name: 'Save' }));
  await page.locator('[data-product="Malta Guinness"]').waitFor();
  // Sell one carton.
  await go('/cash');
  await page.getByTestId('new-sale').click();
  const sale = page.getByTestId('sale-form');
  await sale.locator('[name=item_name]').fill('Malta Guinness');
  await sale.getByTestId('pack-toggle').getByRole('button', { name: /carton of 12/ }).click();
  await tapInSheet(sale.getByRole('button', { name: /Save sale/ }));
  await page.locator('.list .item', { hasText: 'Malta Guinness (carton of 12)' }).first().waitFor();
  await go('/stock');
  const qty = await page.locator('[data-product="Malta Guinness"] [data-qty]').getAttribute('data-qty');
  if (qty !== '36') throw new Error('Malta stock ' + qty);
  // Restock 2 cartons that expire in 10 days.
  await page.locator('[data-product="Malta Guinness"]').click();
  const adj = page.getByTestId('adjust-form');
  await adj.getByRole('tab', { name: /carton of 12/ }).click();
  await adj.locator('[name=change]').fill('2');
  const soon = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
  await adj.locator('[name=expiry]').fill(soon);
  await tapInSheet(adj.getByRole('button', { name: 'Update stock' }));
  await page.waitForFunction(() => document.querySelector('[data-product="Malta Guinness"] [data-qty]')?.getAttribute('data-qty') === '60');
  await page.getByTestId('expiry-alert').waitFor();
  await page.locator('[data-product="Malta Guinness"]').getByTestId('expiry-badge').waitFor();
  await noOverflow();
  await shot('06b-stock-expiry');
});

await step('Credit Passport: the lender’s page shows the server-made record', async () => {
  const months = Array.from({ length: 6 }, (_, i) => ({ month: `2026-${String(5 + i).padStart(2, '0')}`, sales: 2_000_000 + i * 300_000, expenses: 1_200_000, days: 20 + i, records: 120 + i * 10 }));
  const passport = { id: '12345678-aaaa-4aaa-8aaa-aaaaaaaaaaaa', created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 90 * 864e5).toISOString(),
    data: { business: { name: 'Mama Fatu Store', type: 'shop', owner_name: 'Fatmata Kamara', phone: '076123456', address: 'Kissy Road' }, since: '2026-03-01', months,
      sales_6m: 16_500_000, expenses_6m: 7_200_000, active_days_6m: 135, records_6m: 870, credit_given_6m: 3_000_000, credit_repaid_6m: 2_700_000,
      customers_owe_now: 450_000, customers: 42, monime_confirmed_6m: 4_000_000, staff: 3, branches: 1 } };
  await page.route('**/rest/v1/rpc/public_passport*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(passport) }));
  try {
    await page.goto(BASE + '#/p/' + 'a'.repeat(40));        // a public page: no app layout around it
    await Promise.race([page.getByTestId('public-passport').waitFor({ timeout: 15000 }), page.getByTestId('load-failed').waitFor({ timeout: 15000 })]);
    if (!(await page.getByTestId('public-passport').count())) { console.log('   (no cloud in this build: skipped)'); return; }
    const doc = page.getByTestId('public-passport');
    await doc.getByText('Mama Fatu Store').waitFor();
    await doc.getByText(/\(90%\)/).waitFor();                // customers repaid 90% of credit
    await doc.getByText(/Figures worked out by Kopor/).waitFor();
    await noOverflow();
    await shot('14-credit-passport');
  } finally { await page.unroute('**/rest/v1/rpc/public_passport*'); }
});

await step('picture and voice mode: big pictures on Home, record a sale from a picture, back to the full app', async () => {
  await go('/settings');
  await page.getByTestId('simple-mode').check();
  await go('/');
  const home = page.getByTestId('simple-home');
  await home.waitFor();
  await noOverflow();
  await shot('15-picture-mode');
  await home.getByTestId('simple-sold').click();
  await page.getByTestId('sale-form').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('[data-vaul-drawer]').waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
  await home.getByTestId('simple-exit').click();
  await page.getByTestId('search').waitFor();          // the full Home is back
});

await step('hide amounts, data saver and the getting-started list', async () => {
  await go('/');
  await page.getByTestId('hide-money').click();
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-hide'));
  const blur = await page.locator('.balance-card .amount').first().evaluate((el) => getComputedStyle(el).filter);
  if (!/blur/.test(blur)) throw new Error('amounts are not hidden: ' + blur);
  await page.getByTestId('hide-money').click();
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-hide'));
  const list = page.getByTestId('start-checklist');
  if (await list.count()) {                                // the demo has records, so only some steps are left
    await list.getByText(/of 7 done/).waitFor();
    await list.getByRole('button', { name: 'Hide this list' }).click();
    await list.waitFor({ state: 'detached' });
  }
  await go('/settings');
  await page.getByTestId('data-saver').check();
  await page.getByTestId('hide-money-setting').waitFor();
  await page.getByTestId('data-saver').uncheck();
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
  await page.waitForFunction(() => document.documentElement.dataset.text === 'large', null, { timeout: 5000 }).catch(() => {});
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

await step('savings & loan group: save, lend with interest, repay, share out', async () => {
  await go('/groups');
  await page.getByRole('button', { name: /New group/ }).click();
  const f = page.getByTestId('group-form');
  await f.locator('[name=name]').fill('Farmers VSLA');
  await f.locator('[name=kind]').selectOption('savings');
  await f.locator('[name=amount]').fill('100');
  await f.locator('[name=members]').fill('Mariama Kamara\nSahr Koroma');
  await tapInSheet(f.getByRole('button', { name: 'Save' }));
  await page.getByTestId('pot-card').waitFor();
  for (const name of ['Mariama Kamara', 'Sahr Koroma']) await page.getByRole('button', { name, exact: true }).click();
  await page.getByTestId('pot-card').getByText('Le 200').first().waitFor();
  await page.getByTestId('lend').click();
  const lend = page.getByTestId('lend-form');
  await lend.locator('[name=amount]').fill('100');
  await lend.getByText('To repay: Le 110').waitFor();               // 10% interest
  await tapInSheet(lend.getByRole('button', { name: 'Lend' }));
  await page.getByTestId('repay').first().waitFor();
  await page.getByTestId('repay').first().click();
  await tapInSheet(page.getByTestId('repay-form').getByRole('button', { name: 'Repay' }));
  await page.getByText('Repayment recorded').first().waitFor();
  await page.getByTestId('share-out').click();
  const so = page.getByTestId('share-out-sheet');
  await so.getByText('Le 105').first().waitFor();                     // each member: Le 100 saved + Le 5 interest
  await shot('06b-vsla-share-out');
});

await step("member's \"I've paid\" claim: treasurer approves, member counted as paid", async () => {
  // A claim arrives as it would from the member link (synced from the server): put it straight into the phone's database.
  const ok = await page.evaluate(() => new Promise((resolve) => {
    const open = indexedDB.open('kopor2');
    open.onsuccess = () => {
      const idb = open.result;
      const g = idb.transaction('groups').objectStore('groups').getAll();
      g.onsuccess = () => {
        const grp = g.result.find((x) => x.name === 'Farmers VSLA' && !x.deleted);
        if (!grp) return resolve(false);
        const member = grp.members.find((m) => m.name === 'Sahr Koroma');
        const now = Date.now();
        const tx = idb.transaction('group_claims', 'readwrite');
        tx.objectStore('group_claims').put({ id: crypto.randomUUID(), org_id: grp.org_id, created_at: now, updated_at: now, deleted: 0, created_by: null,
          group_id: grp.id, member_id: member.id, kind: 'contribution', round: 2, amount: 10000, method: 'orange', ref: 'MP24A1', note: '', status: 'pending', dirty: 0 });
        tx.oncomplete = () => resolve(true);
      };
    };
  }));
  if (!ok) throw new Error('group not found');
  await go('/groups');
  await page.reload();                                                 // the app reloads its data, like after a sync
  await page.getByText('1 to approve').first().waitFor();
  await page.locator('.item', { hasText: 'Farmers VSLA' }).first().click();
  const claims = page.getByTestId('claims');
  await claims.getByText('MP24A1').waitFor();
  await shot('06d-claim-approve');
  await claims.getByTestId('claim-approve').click();
  await page.getByText('Approved: the payment now counts').waitFor();
  await page.getByTestId('claims').waitFor({ state: 'detached' });
});

await step("member link: \"I've paid\" form sends a claim (stand-in server)", async () => {
  const group = { name: 'Farmers VSLA', kind: 'savings', amount: 10000, frequency: 'weekly', start_date: new Date().toISOString().slice(0, 10), target: null, loan_interest: 10,
    payouts: {}, org_name: "Fatu's Provisions", currency: 'Le', momo_number: '', saved_total: 20000, lent_out: 0, interest_earned: 0,
    members: [{ id: 'm1', name: 'Mariama Kamara', saved: 10000, rounds: [1], owes: 0, next_due: null }, { id: 'm2', name: 'Sahr Koroma', saved: 10000, rounds: [1], owes: 0, next_due: null }] };
  let sent = null;
  await page.route('**/rest/v1/rpc/public_group', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(group) }));
  await page.route('**/rest/v1/rpc/submit_group_claim', (r) => { sent = JSON.parse(r.request().postData() ?? '{}'); r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });
  try {
    await page.goto(BASE + '#/g/grp_test_token_1234567');
    const missing = page.getByTestId('group-missing');
    await Promise.race([page.getByTestId('public-group').waitFor(), missing.waitFor()]);
    if (await missing.count()) { console.log('   (no cloud in this build: checked the "not valid" message)'); return; }
    await page.getByTestId('remind-me').waitFor();                      // free reminder notifications offered
    await page.getByTestId('i-paid').click();
    const f = page.getByTestId('claim-form');
    await f.locator('#claim-member').selectOption({ label: 'Sahr Koroma' });
    await f.getByPlaceholder('Transaction ID').fill('MP99Z');
    await shot('06e-i-paid');
    await f.getByRole('button', { name: 'Send to the treasurer' }).click();
    await page.getByTestId('claim-sent').waitFor();
    if (sent?.member !== 'm2' || sent?.ref !== 'MP99Z' || sent?.amount !== 10000) throw new Error('wrong claim: ' + JSON.stringify(sent));
  } finally { await page.unroute('**/rest/v1/rpc/public_group'); await page.unroute('**/rest/v1/rpc/submit_group_claim'); }
});

await step('reminders: loan reminders listed, daily notification setting shown', async () => {
  await go('/reminders');
  await page.locator('[data-testid=daily-push], [data-testid=push-unsupported]').or(page.getByText('Back up your business online')).first().waitFor();
});

await step('savings goal: create, add money, progress shown', async () => {
  await go('/savings');
  await page.getByTestId('new-goal').click();
  const f = page.getByTestId('goal-form');
  await f.locator('[name=name]').fill('Shop rent');
  await f.locator('[name=target]').fill('3000');
  await tapInSheet(f.getByRole('button', { name: 'Save' }));
  const goal = page.locator('[data-goal="Shop rent"]');
  await goal.waitFor();
  await goal.getByTestId('goal-add').click();
  const m = page.getByTestId('goal-move-form');
  await m.locator('[name=amount]').fill('1000');
  await tapInSheet(m.getByRole('button', { name: 'Add money' }));
  await goal.getByText('Le 1,000').first().waitFor();
  await goal.getByRole('progressbar').and(page.locator('[aria-valuenow="33"]')).waitFor();
  await shot('06c-savings-goal');
});

await step('wallet: balance and money history from Monime (stand-in answers)', async () => {
  // Stand-in for the Monime function, shaped like Monime's documented API, so this runs without a real account.
  const answers = {
    status: { connected: true },
    wallet: { accounts: [{ id: 'fac-1', name: 'Main Wallet', currency: 'SLE', uvan: 'KOP123', balance: 125050 }], total: 125050, at: new Date().toISOString() },
    history: { next: null, items: [
      { id: 't1', type: 'credit', amount: 50000, currency: 'SLE', time: new Date().toISOString(), reference: '', balanceAfter: 125050, kind: 'payment_code', note: '' },
      { id: 't2', type: 'debit', amount: 20000, currency: 'SLE', time: new Date().toISOString(), reference: '', balanceAfter: 75050, kind: 'payout', note: 'Rice supplier' },
    ] },
  };
  await page.route('**/functions/v1/monime', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answers[JSON.parse(r.request().postData() ?? '{}').action] ?? {}) }));
  try {
    await go('/wallet');
    const noCloud = page.getByTestId('wallet-off');
    await Promise.race([page.getByTestId('wallet-balance').waitFor(), noCloud.waitFor()]);
    if (await noCloud.count()) { await noCloud.getByText('Open a free Monime business account').waitFor(); console.log('   (no cloud in this build: checked the set-up steps)'); return; }
    await page.getByTestId('wallet-balance').getByText('Le 1,250.50').waitFor();
    const h = page.getByTestId('wallet-history');
    await h.getByText('USSD payment received').waitFor();
    await h.getByText('Rice supplier').waitFor();
    await h.getByText('−Le 200').waitFor();
    await shot('13b-wallet');
  } finally { await page.unroute('**/functions/v1/monime'); }
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

await step('quotation: create, then turn into an invoice', async () => {
  await go('/invoices');
  await page.getByTestId('new-quote').click();
  const f = page.getByTestId('invoice-form');
  await f.locator('[name=customer]').fill('Bo Builders');
  await f.locator('[name=item_name]').fill('Rice 50kg bag');
  await f.locator('[name=item_qty]').fill('2');
  await f.getByRole('button', { name: 'Create quotation' }).click();
  await page.getByText('QUOTATION').first().waitFor();
  await page.getByText('This is a price offer, not a bill.').first().waitFor();
  await shot('07b-quotation');
  await page.getByTestId('accept-quote').click();
  await page.getByTestId('accept-form').getByRole('button', { name: 'Turn into invoice' }).click();
  await page.getByText('INVOICE').first().waitFor();
  await go('/invoices');
  await page.locator('.item', { hasText: 'Bo Builders' }).filter({ hasText: 'Accepted' }).waitFor();
});

await step('customer statement link', async () => {
  await go('/credit');
  await page.locator('.item', { hasText: 'Test Customer' }).first().click();
  await page.getByTestId('statement').click();
  const link = page.getByTestId('statement-link');
  await page.waitForFunction(() => /#\/s\/[\w-]{16,}$/.test(document.querySelector('[data-testid=statement-link]')?.value ?? ''));
  const url = await link.inputValue();
  await shot('04b-statement');
  await page.keyboard.press('Escape');
  // The demo business is not backed up online, so its link is not on the server: the page must say so clearly.
  await page.goto(BASE + url.slice(url.indexOf('#')));
  // Not on the server (demo is not backed up): "not valid", or "could not load" on a very slow connection.
  await page.locator('[data-testid=statement-missing], [data-testid=load-failed]').first().waitFor({ timeout: 25000 });
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
  await form.locator('summary').click();
  await form.locator('[name=discount]').fill('10');
  await page.getByTestId('totals').getByText('Le 80.50').waitFor(); // (80 − 10) × 1.15
  await shot('10-sale-tax');
  await tapInSheet(form.getByRole('button', { name: /Save sale/ }));
  await page.getByText('Sale saved').waitFor();
});

await step('GST report for the NRA: GST charged this month, net to pay, Excel download', async () => {
  await go('/gst');
  await page.locator('input[type=month]').fill(new Date().toISOString().slice(0, 7));
  const r = page.getByTestId('gst-report');
  await r.getByText('GST charged on sales (15%)').waitFor();
  const net = await page.getByTestId('gst-net').textContent();
  if (!/GST to pay/.test(net) || /\b0\.00\b|Le 0$/.test(net.trim())) throw new Error('net: ' + net);
  await noOverflow();
  await shot('12-gst-report');
  const [dl] = await Promise.all([page.waitForEvent('download'), r.getByRole('button', { name: 'Excel' }).click()]);
  if (!/kopor-gst-\d{4}-\d{2}\.xlsx/.test(dl.suggestedFilename())) throw new Error('file ' + dl.suggestedFilename());
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
  // Mobile money check: earlier sales were paid by Orange Money; the phone's messages show Le 1 less arrived.
  const momo = f.getByTestId('momo-check');
  await momo.waitFor();
  await momo.locator('[name=momo_orange]').fill('1');
  await f.getByTestId('momo-diff').getByText(/missing/).waitFor();
  await shot('11-close-day');
  await tapInSheet(f.getByRole('button', { name: 'Save day close' }));
  await page.getByText('Day closed').waitFor();
});

await step('fraud watch: mobile money shortfall, refunds and unconfirmed payments listed; safety tips', async () => {
  await go('/watch');
  await page.getByTestId('watch-people').waitFor();
  await page.getByRole('tab', { name: /^All/ }).click();
  const list = page.getByTestId('watch-flags');
  await list.locator('[data-kind=momoShort]').first().waitFor();
  await list.locator('[data-kind=refund]').first().waitFor();
  await page.getByText(/not confirmed by Monime/).waitFor();
  await noOverflow();
  await shot('13-fraud-watch');
  await page.getByRole('tab', { name: 'Stay safe' }).click();
  if ((await page.getByTestId('safety-tips').locator('.card').count()) !== 6) throw new Error('tips');
});

await step('owner dashboard: every user and business, a business page, money, AI and an announcement on Home', async () => {
  // Stand-in for the admin server (the real one only answers phones listed in KOPOR_ADMIN_PHONES).
  const days = Array.from({ length: 14 }, (_, i) => ({ day: new Date(Date.now() - (13 - i) * 864e5).toISOString().slice(0, 10), n: i, active: i % 3, records: i * 2 }));
  const ORGID = '99999999-9999-4999-8999-999999999999';
  const calls = [];
  const answers = {
    stats: { stats: { accounts: 12, accounts_week: 3, businesses: 9, businesses_active_week: 5, staff: 4, pro: 2, records_week: 140, money_recorded_week: 5_000_000, ai_today: 17,
      payments_completed: 6, locked_accounts: 0, signups_14d: days, activity_14d: days, business_types: { shop: 7, food: 2 }, reports_waiting: 1 },
      health: { ai: ['groq', 'gemini'], voice: true, voice_backup: false, pin_pepper: true, payments: true, pro_billing: false }, at: new Date().toISOString() },
    reports: { reports: [] }, log: { log: [] },
    users: { total: 2, rows: [
      { id: 'u1', phone: '23276123456', name: 'Fatmata Kamara', created_at: new Date().toISOString(), last_sign_in_at: new Date().toISOString(), banned_until: null, businesses: [{ id: ORGID, name: 'Mama Fatu Store', role: 'owner' }] },
      { id: 'u2', phone: '23288111222', name: null, created_at: new Date().toISOString(), last_sign_in_at: null, banned_until: '2999-01-01T00:00:00Z', businesses: [] }] },
    orgs: { total: 1, rows: [{ id: ORGID, name: 'Mama Fatu Store', type: 'shop', owner_name: 'Fatmata Kamara', owner_phone: '23276123456', phone: '', plan: 'free', plan_until: null,
      created_at: Date.now() - 864e6, staff: 2, branches: 1, records: 320, records_30d: 85, money_in_30d: 2_400_000, last_record: Date.now(), payments: 'easy' }] },
    org: { org: { id: ORGID, name: 'Mama Fatu Store', type: 'shop', owner_name: 'Fatmata Kamara', phone: '', address: 'Kissy Road', momo_number: '', plan: 'free', plan_until: null, created_at: Date.now() - 864e6, owner_phone: '23276123456' },
      members: [{ name: 'Fatmata Kamara', role: 'owner', phone: '', active: true, account: '23276123456', last_sign_in_at: new Date().toISOString() }], branches: ['Main'],
      counts: { customers: 40, suppliers: 3, products: 55, records: 320, invoices_unpaid: 2, groups: 1 }, money_30d: { in: 2_400_000, out: 900_000 }, credit_outstanding: 350_000,
      activity_14d: days, audit: [{ member_name: 'Fatmata Kamara', action: 'create', entity: 'transactions', summary: 'Sale 2 Soap bar', at: Date.now() }], payments: [], payments_mode: 'easy', ai_14d: 9 },
    money: { received_30d: 1_000_000, sent_30d: 990_000, by_status: { completed: 6, pending: 1 }, own_accounts: 1, easy_accounts: 2, daily_14d: days,
      latest: [{ kind: 'ussd', amount: 50_000, status: 'completed', note: 'Rice', created_at: Date.now(), business: 'Mama Fatu Store', org_id: ORGID }] },
    ai: { daily_14d: days, top_week: [{ org_id: ORGID, name: 'Mama Fatu Store', n: 30 }], guests_today: 4 },
    announcements: { announcements: [] }, announce: { ok: true },
  };
  await page.route('**/functions/v1/admin', async (r) => {
    const b = JSON.parse(r.request().postData() || '{}');
    calls.push(b);
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answers[b.action] ?? { ok: true }) });
  });
  await page.route('**/rest/v1/announcements*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'n1', message: 'New: easy payments are here', level: 'info' }]) }));
  try {
    await go('/admin');
    await page.locator('.owner-tabs').waitFor({ timeout: 8000 }).catch(() => {});
    if (!(await page.locator('.owner-tabs').count())) {
      console.log('   (no cloud in this build: skipped)'); return;
    }
    await noOverflow();
    await page.locator('.owner-tabs').getByRole('tab', { name: 'Users' }).click();
    await page.getByTestId('admin-users').getByText('Fatmata Kamara').waitFor();
    await page.getByTestId('admin-users').getByText('Suspended').waitFor();               // the banned account is marked
    await page.locator('.owner-tabs').getByRole('tab', { name: 'Businesses' }).click();
    await page.getByTestId('admin-orgs').getByText('Mama Fatu Store').click();
    await page.getByTestId('admin-org').getByText('Customers owe them').waitFor();
    await page.getByTestId('admin-org').getByText('Sale 2 Soap bar').waitFor();
    if (!calls.some((c) => c.action === 'org' && c.orgId === ORGID)) throw new Error('business detail not asked for');
    await noOverflow();
    await shot('10b-owner-business');
    await page.locator('.owner-tabs').getByRole('tab', { name: 'Money' }).click();
    await page.getByTestId('admin-money').getByText('Mama Fatu Store').waitFor();
    await page.locator('.owner-tabs').getByRole('tab', { name: 'AI' }).click();
    await page.getByText('Most AI use this week').waitFor();
    await page.locator('.owner-tabs').getByRole('tab', { name: 'News' }).click();
    await page.getByTestId('admin-news').locator('textarea').fill('New: easy payments are here');
    await page.getByTestId('admin-news').getByRole('button', { name: 'Show to everyone' }).click();
    await page.getByText('Announcement is live').waitFor();
    if (calls.at(-2)?.action !== 'announce' && !calls.some((c) => c.action === 'announce' && c.message === 'New: easy payments are here')) throw new Error('announce not sent');
    // Everyone sees it on Home, and can close it.
    await go('/');
    const note = page.getByTestId('announcement');
    await note.getByText('New: easy payments are here').waitFor({ timeout: 8000 });
    await note.getByRole('button', { name: 'Close' }).click();
    await note.waitFor({ state: 'detached' });
  } finally { await page.unroute('**/functions/v1/admin'); await page.unroute('**/rest/v1/announcements*'); }
});

await step('easy payments: the owner types a mobile money number and is ready to receive', async () => {
  // Stand-in for the Kopor server (the real one needs Kopor's Monime account): records what the app asked for.
  const calls = [];
  let st = { connected: false, mode: null, easyAvailable: true };
  await page.route('**/functions/v1/monime', async (r) => {
    const b = JSON.parse(r.request().postData() || '{}');
    calls.push(b);
    if (b.action === 'easy') st = { connected: true, mode: 'easy', easyAvailable: true, phone: '076 *** 456', providerId: b.providerId || 'm17', auto: b.auto ?? st.auto ?? true };
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b.action === 'easy' ? { ok: true, phone: '076 *** 456', providerId: 'm17' } : st) });
  });
  try {
    await go('/payments');
    await Promise.race([page.getByTestId('easy-form').waitFor(), page.getByText('Payments need a Kopor cloud account').waitFor()]);
    if (!(await page.getByTestId('easy-form').count())) { console.log('   (no cloud in this build: checked the message instead)'); return; }
    const form = page.getByTestId('easy-form');
    await form.locator('input[type=tel]').fill('076 123 456');
    await form.getByText('Network: Orange Money').waitFor();          // worked out from the number
    await form.getByRole('button', { name: 'Start receiving payments' }).click();
    await page.getByTestId('easy-on').getByText('Payments go to 076 *** 456 (Orange Money)').waitFor();
    const sent = calls.find((c) => c.action === 'easy');
    if (sent.phone !== '+23276123456' || sent.providerId) throw new Error('sent ' + JSON.stringify(sent));
    await shot('07c-easy-payments');
    await page.getByTestId('easy-on').locator('input[type=checkbox]').uncheck();  // keep payments until I send them
    await page.getByText('Keep payments in Kopor until I send them').waitFor();
    if (calls.at(-1).auto !== false || calls.at(-1).phone) throw new Error('auto off sent ' + JSON.stringify(calls.at(-1)));
  } finally { await page.unroute('**/functions/v1/monime'); }
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
  await page.getByTestId('report-business').waitFor();
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
await step('report a problem: send from More, saved for later when offline', async () => {
  await go('/more');
  await page.getByTestId('report-row').click();
  const f = page.getByTestId('report-form');
  await f.getByRole('radio', { name: 'Wrong amount' }).click();
  await f.locator('[name=message]').fill('My profit for today shows the wrong amount');
  await tapInSheet(f.getByRole('button', { name: 'Send report' }));
  await page.getByTestId('report-done').waitFor();
  const queued = await page.evaluate(() => JSON.parse(localStorage.getItem('kopor-report-queue') ?? '[]'));
  if (queued.length !== 1 || queued[0].kind !== 'money' || JSON.stringify(queued[0].app_info).includes('Aminata')) throw new Error(JSON.stringify(queued).slice(0, 200));
  await shot('16-report');
  await page.evaluate(() => localStorage.removeItem('kopor-report-queue'));
});
await step('profit & loss statement and price list', async () => {
  await go('/health');
  await page.getByTestId('open-pnl').click();
  const p = page.getByTestId('pnl');
  await p.getByText('Gross profit').waitFor();
  await p.getByText('Net profit').waitFor();
  const cells = await p.locator('td.r').allInnerTexts();
  if (cells.length < 4 || !cells.every((c) => /Le/.test(c))) throw new Error('statement figures missing: ' + cells.join(' | '));
  await page.getByRole('tab', { name: 'This year' }).click();
  await page.getByRole('tab', { name: 'This year', selected: true }).waitFor();
  await shot('17-pnl');
  await go('/stock');
  await page.getByTestId('share-catalog').waitFor();
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

// Last, because it removes the demo business: an owner who forgot the lock-screen PIN can start again.
await step('owner forgot the lock PIN: remove the business from this phone', async () => {
  await page.reload();
  await page.locator('#pin').waitFor();
  await page.getByTestId('owner-forgot').click();
  const f = page.getByTestId('owner-forgot-form');
  const remove = f.getByRole('button', { name: 'Remove from this phone' });
  if (!(await remove.isDisabled())) throw new Error('remove must wait for the business name');
  await f.locator('#confirm-name').fill("fatu's provisions");
  await remove.click();
  await page.getByTestId('demo').waitFor();             // back to the welcome screen, no lock
  await page.reload();
  await page.getByTestId('demo').waitFor();             // and it stays unlocked after a reload
});

await browser.close();
server?.kill();
if (errors.length) { console.log('\nJS errors:\n' + errors.join('\n')); failed++; }
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
