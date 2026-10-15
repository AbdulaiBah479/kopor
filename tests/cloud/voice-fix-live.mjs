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
// Log each AI call's answer, to see which step (transcription, correction or understanding) changes the words.
page.on('response', async (r) => { if (r.url().includes('/functions/v1/ai')) { try { console.log('  server:', JSON.stringify(await r.json()).slice(0, 220)); } catch { /* not JSON */ } } });
// Keep a copy of the recording the app uploads (for checking what Whisper actually received).
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
  // The test microphone plays the 7.35-second fixture from the moment it opens, then loops. Stop after one sentence:
  // tested live, Whisper drops the amount when the same sentence is heard twice in one recording.
  await page.waitForTimeout(7000);
  await page.getByTestId('mic').click();
  await page.getByTestId('ai-preview').waitFor({ timeout: 40000 });
  const heard = await page.locator('#voice-text').inputValue();
  const preview = await page.getByTestId('ai-preview').innerText();
  console.log('Written down:', heard);
  console.log('Understood :', preview.replace(/\s+/g, ' '));
  const checks = [['customer is Aminata Sesay', /Aminata Sesay/], ['product is Palm oil 4L', /Palm oil 4L/], ['amount Le 360 (or worked out from the price list, marked for checking)', /Le 360|price list/]];
  for (const [name, re] of checks) { const pass = re.test(preview); ok &&= pass; console.log(pass ? '✓' : '✗', name); }
} catch (e) { ok = false; console.log('✗', e.message.split('\n')[0]); await page.screenshot({ path: 'screenshots/voice-fix-fail.png' }); }
await browser.close(); server.kill();
console.log(ok ? '\nVoice correction live test passed' : '\nVoice correction live test FAILED');
process.exit(ok ? 0 : 1);
