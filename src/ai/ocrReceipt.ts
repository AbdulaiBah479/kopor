// Offline receipt reading: turn the plain text that on-phone OCR (Tesseract) reads from a printed receipt into
// lines (name, quantity, unit price) and a total. Used when there is no internet; the result is shown for checking,
// exactly like the AI reading. Amounts on receipts are major units (Le); returned values are minor units (cents).
import type { ScanResult } from './assistant';

const NUM = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?`;
const num = (s: string) => Number(s.replace(/,/g, ''));
const minor = (major: number) => Math.round(major * 100);
// Lines that are never goods.
const SKIP = /(sub\s*-?\s*total|\btotal\b|\btax\b|\bvat\b|\bgst\b|change|\bcash\b|balance|thank|receipt|\btel\b|phone|date|invoice|cashier|\bno\b\.?\s*\d|^#|www\.|@)/i;
// Sierra Leone phone numbers (076 555 222, +23276555222): the shop's address line, not goods.
const PHONE = /(\+?232[\s-]?\d{2}|\b0\d{2})[\s-]?\d{3}[\s-]?\d{3}\b/;

export function parseReceiptText(text: string): ScanResult {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').replace(/\b(?:Le|SLE|NLe)\s*/gi, '').trim()).filter(Boolean);
  const items: ScanResult['items'] = [];
  let total = 0;
  for (const line of lines) {
    if (/\btotal\b/i.test(line) && !/sub\s*-?\s*total/i.test(line)) {
      const n = [...line.matchAll(new RegExp(NUM, 'g'))].map((m) => num(m[0]));
      if (n.length) total = minor(n[n.length - 1]);
      continue;
    }
    if (SKIP.test(line) || PHONE.test(line) || !/[a-z]{2}/i.test(line)) continue;
    // "NAME 2 x 720 1,440" (quantity × unit price, then the line total)
    let m = line.match(new RegExp(String.raw`^(.*?[a-z].*?)\s+(\d+(?:\.\d+)?)\s*[x×*@]\s*(${NUM})(?:\s+(${NUM}))?$`, 'i'));
    if (m) { items.push({ name: tidy(m[1]), qty: num(m[2]), price: minor(num(m[3])) }); continue; }
    // "NAME 2 720 1440" (quantity, unit price, line total that matches)
    m = line.match(new RegExp(String.raw`^(.*?[a-z].*?)\s+(\d+)\s+(${NUM})\s+(${NUM})$`, 'i'));
    if (m && Math.abs(num(m[2]) * num(m[3]) - num(m[4])) < 0.01) { items.push({ name: tidy(m[1]), qty: num(m[2]), price: minor(num(m[3])) }); continue; }
    // "3 CANDLES 120" (quantity first, then the line total)
    m = line.match(new RegExp(String.raw`^(\d+)\s+([a-z].*?)\s+(${NUM})$`, 'i'));
    if (m && num(m[1]) > 0 && num(m[1]) < 1000) { items.push({ name: tidy(m[2]), qty: num(m[1]), price: minor(num(m[3]) / num(m[1])) }); continue; }
    // "NAME 250" (one item, its price)
    m = line.match(new RegExp(String.raw`^(.*?[a-z].*?)\s+(${NUM})$`, 'i'));
    if (m) items.push({ name: tidy(m[1]), qty: 1, price: minor(num(m[2])) });
  }
  const vendor = lines.find((l) => /[a-z]{3}/i.test(l) && !/\d/.test(l) && !SKIP.test(l)) ?? '';
  if (!total) total = items.reduce((s, i) => s + i.qty * i.price, 0);
  return { kind: 'purchase', vendor: vendor === items[0]?.name ? '' : vendor, date: '', items, total, category: 'stock' };
}

/** "RICE 50KG BAG" -> "Rice 50kg Bag": receipts shout in capitals; the stock list does not. */
function tidy(s: string) {
  const t = s.replace(/[|_~]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t === t.toUpperCase() ? t.toLowerCase().replace(/(^|\s)([a-z])/g, (_, a, b) => a + b.toUpperCase()) : t;
}

/** Read a photo's text on the phone with Tesseract (no internet; the engine and English data come with Kopor). */
export async function ocrImage(image: Blob | string): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  const base = `${import.meta.env.BASE_URL}tesseract/`;
  const worker = await createWorker('eng', 1, { workerPath: `${base}worker.min.js`, corePath: base, langPath: `${base}lang`, gzip: true, workerBlobURL: false });
  try { return (await worker.recognize(image)).data.text; } finally { await worker.terminate(); }
}
