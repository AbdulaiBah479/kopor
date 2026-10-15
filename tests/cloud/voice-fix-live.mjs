// LIVE voice test with mispronounced/misspelt names: the recording says "Aminatta Sessay ... palm oyl".
// Kopor must still record it for the real customer "Aminata Sesay" and product "Palm oil 4L" (demo business).
// Run after `npm run build`: node tests/cloud/voice-fix-live.mjs
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const PORT = 4179, BASE = `http://localhost:${PORT}/`;
const wav = new URL('../fixtures/credit.wav', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => server.stdout.on('data', (d) => String(d).includes(String(PORT)) && r()));
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : 'chrome',
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.grantPermissions(['microphone']).catch(() => {});
const page = await ctx.newPage();
let ok = true;
try {
  await page.goto(BASE);
  await page.getByTestId('demo').click();
  await page.getByText("Today's profit").waitFor({ timeout: 90000 });
  await page.locator('.driver-popover').waitFor({ timeout: 8000 }).catch(() => {});
  for (let i = 0; i < 8 && await page.locator('.driver-popover').count(); i++) { await page.locator('.driver-popover-next-btn').click(); await page.waitForTimeout(200); }
  await page.getByRole('button', { name: 'Speak' }).click();
  await page.getByTestId('mic').click();
  await page.getByText(/Listening/).waitFor();
  await page.waitForTimeout(7500);
  await page.getByTestId('mic').click();
  await page.getByTestId('ai-preview').waitFor({ timeout: 40000 });
  const heard = await page.locator('#voice-text').inputValue();
  const preview = await page.getByTestId('ai-preview').innerText();
  console.log('Written down:', heard);
  console.log('Understood :', preview.replace(/\s+/g, ' '));
  const checks = [['customer is Aminata Sesay', /Aminata Sesay/], ['product is Palm oil 4L', /Palm oil 4L/], ['amount Le 360', /Le 360/]];
  for (const [name, re] of checks) { const pass = re.test(preview); ok &&= pass; console.log(pass ? '✓' : '✗', name); }
} catch (e) { ok = false; console.log('✗', e.message.split('\n')[0]); await page.screenshot({ path: 'screenshots/voice-fix-fail.png' }); }
await browser.close(); server.kill();
console.log(ok ? '\nVoice correction live test passed' : '\nVoice correction live test FAILED');
process.exit(ok ? 0 : 1);
