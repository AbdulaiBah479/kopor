// Debug helper: open the demo, tap Speak, print any error.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const PORT = 4177, BASE = `http://localhost:${PORT}/`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => server.stdout.on('data', (d) => String(d).includes(String(PORT)) && r()));
const browser = await chromium.launch({ channel: 'msedge' });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 600)); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message, e.stack?.slice(0, 400)));
await page.goto(BASE);
await page.getByTestId('demo').click();
await page.getByText("Today's profit").waitFor({ timeout: 90000 });
await page.locator('.driver-popover').waitFor({ timeout: 8000 }).catch(() => {});
for (let i = 0; i < 8 && await page.locator('.driver-popover').count(); i++) { await page.locator('.driver-popover-next-btn').click(); await page.waitForTimeout(200); }
await page.getByRole('button', { name: 'Speak' }).click();
await page.waitForTimeout(5000);
console.log('voice form visible:', await page.getByTestId('voice-form').count());
await browser.close();
server.kill();
