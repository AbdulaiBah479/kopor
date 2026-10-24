// Bring existing records into Kopor in one go: customers (with what they owe) and stock (with prices and quantities),
// from a spreadsheet (Excel, CSV, Google Sheets export), the phone's contacts (picker or a .vcf file), or a photo of a
// notebook page. Column names are recognised in English, Krio and French; nothing is saved until the owner checks it.
import type { Ctx } from '@/db/repo';
import { assertCan } from '@/db/permissions';
import { parseMoney } from '@/lib/money';
import { addEntry, ensureContact } from './credit';
import { saveProduct } from './stock';
import { findByName, type Book } from './book';

export interface CustomerRow { name: string; phone: string; owes: number }
export interface ProductRow { name: string; price: number; cost: number; qty: number; low: number; unit: string }

const COLS: Record<string, RegExp> = {
  name: /^(name|customer|client|nem|nom|item|product|produit|goods|description|article)/i,
  phone: /(phone|mobile|tel|number|fon|nɔmba|numéro|whatsapp)/i,
  owes: /(owe|balance|debt|credit|due|amount|ɔw|dɛt|trɔs|solde|dette|montant)/i,
  price: /(sell|selling|price|prix|sɛl|vente)/i,
  cost: /(cost|buy|purchase|kɔst|achat|coût|cout)/i,
  qty: /(qty|quantity|stock|count|on hand|how many|quantité|quantite|kɔnt)/i,
  low: /(low|reorder|minimum|min\b|alert|seuil)/i,
  unit: /^(unit|unité|unite)/i,
};

/** Find which column holds what. The header row is the first row with a name-like column. */
function mapColumns(rows: unknown[][]): { header: number; at: Partial<Record<keyof typeof COLS, number>> } {
  for (let r = 0; r < Math.min(rows.length, 5); r++) {
    const cells = rows[r].map((c) => String(c ?? '').trim());
    const at: Partial<Record<keyof typeof COLS, number>> = {};
    cells.forEach((c, i) => {
      if (!c) return;
      // "cost price" is cost, not price; "selling price" is price.
      for (const k of ['cost', 'price', 'qty', 'low', 'owes', 'phone', 'unit', 'name'] as const) if (at[k] === undefined && COLS[k].test(c)) { at[k] = i; break; }
    });
    if (at.name !== undefined) return { header: r, at };
  }
  return { header: -1, at: { name: 0, phone: 1, owes: 2 } }; // no header: name, then phone, then amount
}

const num = (v: unknown) => { const n = Number(String(v ?? '').replace(/[,\s]/g, '')); return Number.isFinite(n) ? n : 0; };
const cell = (row: unknown[], i: number | undefined) => (i === undefined ? '' : String(row[i] ?? '').trim());

export function customersFromTable(rows: unknown[][]): CustomerRow[] {
  const { header, at } = mapColumns(rows);
  return rows.slice(header + 1).map((r) => ({ name: cell(r, at.name), phone: cell(r, at.phone).replace(/[^\d+]/g, ''), owes: Math.max(0, parseMoney(cell(r, at.owes))) }))
    .filter((r) => r.name);
}

export function productsFromTable(rows: unknown[][]): ProductRow[] {
  const { header, at } = mapColumns(rows);
  return rows.slice(header + 1).map((r) => ({
    name: cell(r, at.name), price: Math.max(0, parseMoney(cell(r, at.price))), cost: Math.max(0, parseMoney(cell(r, at.cost))),
    qty: Math.max(0, num(cell(r, at.qty))), low: Math.max(0, num(cell(r, at.low))), unit: cell(r, at.unit) || 'pcs',
  })).filter((r) => r.name);
}

/** Contacts exported from a phone (.vcf). */
export function parseVcf(text: string): CustomerRow[] {
  return text.replace(/\r\n[ \t]/g, '').split(/BEGIN:VCARD/i).slice(1).map((card) => {
    const name = card.match(/^FN[^:]*:(.+)$/im)?.[1]?.trim() ?? card.match(/^N[^:]*:([^;\r\n]*);?([^;\r\n]*)/im)?.slice(1).reverse().join(' ').trim() ?? '';
    const phone = (card.match(/^TEL[^:]*:(.+)$/im)?.[1] ?? '').replace(/[^\d+]/g, '');
    return { name: name.replace(/\\,/g, ',').replace(/\\;/g, ';'), phone, owes: 0 };
  }).filter((c) => c.name);
}

/** Read a spreadsheet or contacts file into rows. SheetJS (already used for Excel export) reads xlsx, xls, csv and ods. */
export async function readTable(file: File): Promise<{ rows: unknown[][]; vcf: boolean; text?: string }> {
  if (/\.vcf$/i.test(file.name) || file.type === 'text/vcard' || file.type === 'text/x-vcard') return { rows: [], vcf: true, text: await file.text() };
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return { rows: XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, raw: false }), vcf: false };
}

/** Save the checked customers. Existing names are kept (their phone is filled in if missing); what new ones owe becomes an opening balance. */
export async function importCustomers(ctx: Ctx, book: Book, rows: CustomerRow[]) {
  assertCan(ctx.role, 'record');
  let added = 0, existing = 0, balances = 0;
  for (const r of rows) {
    const known = findByName(book.contacts, r.name);
    const c = await ensureContact(ctx, r.name, r.phone, 'customer');
    if (known) { existing++; continue; }
    added++;
    if (r.owes > 0) { await addEntry(ctx, { contactId: c.id, type: 'gave', amount: r.owes, note: 'Opening balance (imported)' }); balances++; }
  }
  return { added, existing, balances };
}

/** Save the checked products. Products already in the stock list are left as they are. */
export async function importProducts(ctx: Ctx, book: Book, rows: ProductRow[]) {
  assertCan(ctx.role, 'stock');
  let added = 0, existing = 0;
  const seen = new Set<string>();
  for (const r of rows) {
    const key = r.name.trim().toLowerCase();
    if (findByName(book.products, r.name) || seen.has(key)) { existing++; continue; }
    seen.add(key);
    await saveProduct(ctx, { name: r.name, unit: r.unit || 'pcs', price: r.price, cost: r.cost, low_at: r.low, opening: r.qty || undefined });
    added++;
  }
  return { added, existing };
}
