// Generates public/og.jpg (1200×630), the preview card shown when the Kopor link is shared on WhatsApp/Facebook/X.
// Run: node tools/og-image.mjs   (needs docs/img/home.png from tools/marketing-shots.mjs)
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const shot = readFileSync('docs/img/home.png').toString('base64');
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; width: 1200px; height: 630px; font-family: "Segoe UI", system-ui, sans-serif; color: #fff;
    background: radial-gradient(120% 140% at 0% 0%, #059669 0%, #064e3b 60%, #022c22 100%); display: flex; align-items: center; overflow: hidden; }
  .text { flex: 1; padding: 0 0 0 80px; }
  .logo { width: 84px; height: 84px; border-radius: 22px; background: #fff; color: #047857; font-size: 52px; font-weight: 800; display: grid; place-items: center; margin-bottom: 30px; }
  h1 { font-size: 64px; line-height: 1.05; margin: 0 0 22px; letter-spacing: -1.5px; font-weight: 800; }
  p { font-size: 28px; line-height: 1.35; margin: 0; color: #d1fae5; max-width: 560px; }
  .tags { margin-top: 30px; display: flex; gap: 12px; flex-wrap: wrap; }
  .tags span { font-size: 20px; padding: 8px 16px; border-radius: 99px; background: rgba(255,255,255,.14); }
  .phone { width: 330px; height: 714px; margin: 90px 80px 0 0; border-radius: 44px; background: #000; padding: 12px; box-shadow: 0 30px 80px rgba(0,0,0,.45); transform: rotate(-4deg); }
  .phone img { width: 100%; height: 100%; object-fit: cover; object-position: top; border-radius: 34px; display: block; }
</style></head><body>
  <div class="text">
    <div class="logo">K</div>
    <h1>Your business book,<br>in your pocket.</h1>
    <p>Credit, cash, stock, osusu, invoices and mobile money. Free, works offline, speaks Krio.</p>
    <div class="tags"><span>Orange Money</span><span>Afrimoney</span><span>QMoney</span><span>Made in Salone</span></div>
  </div>
  <div class="phone"><img src="data:image/png;base64,${shot}"></div>
</body></html>`;

const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : 'chrome') });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html);
await page.screenshot({ path: 'public/og.jpg', type: 'jpeg', quality: 82 });
await browser.close();
console.log('public/og.jpg written');
