import { beforeEach, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { db } from '@/db/schema';
import type { Ctx } from '@/db/repo';
import { PermissionError } from '@/db/permissions';
import { createOrg, updateOrg, addBranch, saveMember } from '@/domain/org';
import { loadBook } from '@/domain/book';
import { recordSale, recordExpense, summary } from '@/domain/cash';
import { saveProduct, stockLevels } from '@/domain/stock';
import { balances } from '@/domain/credit';
import { computeTotals } from '@/domain/tax';
import { recordReturn } from '@/domain/returns';
import { expectedCash, closeDay } from '@/domain/closing';
import { createInvoice, voidInvoice, invoiceTotal } from '@/domain/invoices';
import { isPro } from '@/domain/plan';
import { businessWorkbook } from '@/features/excel';
import { invoicePdf, reportPdf } from '@/features/pdf';
import { receiptBytes, rawbtLink } from '@/features/printer';
import { latinSafe } from '@/lib/text';
import { today } from '@/lib/dates';
import en from '@/i18n/en';

let ctx: Ctx;
const book = async () => (await loadBook(ctx.orgId))!;
// Minimal translator for document builders.
const t = (k: string, o: Record<string, unknown> = {}) => {
  const v = k.split('.').reduce<unknown>((x, p) => (x as Record<string, unknown>)?.[p], en);
  return typeof v === 'string' ? v.replace(/\{\{(\w+)\}\}/g, (_, n) => String(o[n] ?? '')) : k;
};

beforeEach(async () => {
  await db.delete();
  await db.open();
  const { org, owner } = await createOrg({ name: 'Tax Shop', type: 'shop', owner: 'Ama', phone: '076000000' });
  ctx = { orgId: org.id, memberId: owner.id, memberName: owner.name, branchId: null, role: 'owner' };
});

describe('tax & discounts', () => {
  it('computes exclusive and inclusive tax correctly', () => {
    expect(computeTotals(10000, 1000, { rate: 15, inclusive: false })).toEqual({ subtotal: 10000, discount: 1000, tax: 1350, total: 10350 });
    expect(computeTotals(11500, 0, { rate: 15, inclusive: true })).toEqual({ subtotal: 11500, discount: 0, tax: 1500, total: 11500 });
    expect(computeTotals(500, 900, { rate: 0, inclusive: true }).total).toBe(0); // discount can't exceed subtotal
  });

  it('records tax on sales and reports sales net of tax', async () => {
    await updateOrg(ctx, { tax_rate: 15, tax_inclusive: 0 });
    const s = await recordSale(ctx, { items: [{ name: 'Water', qty: 2, price: 5000 }], discount: 1000, method: 'cash' });
    expect(s.amount).toBe(10350);
    expect(s.tax).toBe(1350);
    const sum = summary(await book(), today(), today());
    expect(sum.sales).toBe(9000);
    expect(sum.tax).toBe(1350);
    expect(sum.byMethod.cash).toBe(10350);
  });

  it('invoice total includes discount and tax; voiding removes the debt and returns stock', async () => {
    await updateOrg(ctx, { tax_rate: 15, tax_inclusive: 0 });
    const p = await saveProduct(ctx, { name: 'Rice', unit: 'bag', price: 10000, cost: 8000, low_at: 1, opening: 5 });
    const inv = await createInvoice(ctx, { customer: 'Hotel', items: [{ name: 'Rice', qty: 2 }], discount: 2000, paid: false });
    expect(invoiceTotal(inv)).toBe(20700);
    let b = await book();
    expect(balances(b.ledger).get(inv.contact_id!)).toBe(20700);
    expect(stockLevels(b).get(p.id)).toBe(3);
    await voidInvoice(ctx, inv.id);
    b = await book();
    expect(balances(b.ledger).get(inv.contact_id!) ?? 0).toBe(0);
    expect(stockLevels(b).get(p.id)).toBe(5);
  });
});

describe('returns', () => {
  it('returns items to stock and refunds proportionally (including tax)', async () => {
    await updateOrg(ctx, { tax_rate: 15, tax_inclusive: 1 });
    const p = await saveProduct(ctx, { name: 'Soap', unit: 'pcs', price: 1150, cost: 800, low_at: 1, opening: 10 });
    const sale = await recordSale(ctx, { items: [{ name: 'Soap', qty: 4 }], method: 'orange' });
    const refund = await recordReturn(ctx, sale.id, [{ index: 0, qty: 1 }]);
    expect(refund.amount).toBe(1150);
    expect(refund.method).toBe('orange');
    const b = await book();
    expect(stockLevels(b).get(p.id)).toBe(7);
    const s = summary(b, today(), today());
    expect(s.sales).toBe(Math.round((4600 - sale.tax!) * 0.75));
    await expect(recordReturn(ctx, sale.id, [{ index: 0, qty: 4 }])).rejects.toThrow('errx.returnTooMany');
  });

  it('credit sale returns reduce the debt instead of paying cash', async () => {
    const sale = await recordSale(ctx, { items: [{ name: 'Oil', qty: 2, price: 1000 }], method: 'credit', customer: 'Musa' });
    await recordReturn(ctx, sale.id, [{ index: 0, qty: 1 }]);
    expect(balances((await book()).ledger).get(sale.contact_id!)).toBe(1000);
  });

  it('cashiers cannot record refunds', async () => {
    const sale = await recordSale(ctx, { items: [{ name: 'Oil', qty: 2, price: 1000 }], method: 'cash' });
    await expect(recordReturn({ ...ctx, role: 'cashier' }, sale.id, [{ index: 0, qty: 1 }])).rejects.toBeInstanceOf(PermissionError);
  });
});

describe('end-of-day close', () => {
  it('expects float + cash sales − cash out, and records the difference', async () => {
    await recordSale(ctx, { amount: 50000, method: 'cash' });
    await recordSale(ctx, { amount: 30000, method: 'orange' });
    await recordExpense(ctx, { amount: 5000, category: 'food', method: 'cash' });
    const x = expectedCash(await book(), today(), 10000);
    expect(x.expected).toBe(55000);
    const c = await closeDay({ ...ctx, role: 'cashier' }, { openingFloat: 10000, counted: 54000, expected: x.expected });
    expect(c.difference).toBe(-1000);
    expect((await book()).closings).toHaveLength(1);
  });
});

describe('plan limits', () => {
  it('free plan allows 1 branch and 3 staff', async () => {
    await expect(addBranch(ctx, 'Second shop')).rejects.toThrow('errx.proLimit');
    await saveMember(ctx, { name: 'A', phone: '', role: 'cashier', branch_id: null });
    await saveMember(ctx, { name: 'B', phone: '', role: 'cashier', branch_id: null });
    await expect(saveMember(ctx, { name: 'C', phone: '', role: 'cashier', branch_id: null })).rejects.toThrow('errx.proLimit');
  });
  it('pro is active only until it expires', () => {
    expect(isPro({ plan: 'pro', plan_until: Date.now() + 1000 })).toBe(true);
    expect(isPro({ plan: 'pro', plan_until: Date.now() - 1000 })).toBe(false);
    expect(isPro({ plan: 'free', plan_until: null })).toBe(false);
  });
});

describe('documents: Excel, PDF, receipts', () => {
  it('builds an Excel workbook with all sheets and correct values', async () => {
    await recordSale(ctx, { items: [{ name: 'Water', qty: 3, price: 500 }], method: 'cash', customer: 'Isatu' });
    const blob = businessWorkbook(await book(), t);
    const wb = XLSX.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array' });
    expect(wb.SheetNames.length).toBe(7);
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]]);
    expect(rows[0][en.common.amount]).toBe(15);
  });

  it('creates invoice and report PDFs', async () => {
    const inv = await createInvoice(ctx, { customer: 'Ɛlizabɛt Kɔrɔma', items: [{ name: 'Rice', qty: 1, price: 85000 }], paid: true });
    const pdf = invoicePdf(await book(), inv, t, 'en-GB');
    const head = new TextDecoder().decode(new Uint8Array(await pdf.slice(0, 5).arrayBuffer()));
    expect(head).toBe('%PDF-');
    expect((await reportPdf(await book(), t, 'en-GB').arrayBuffer()).byteLength).toBeGreaterThan(1000);
  });

  it('encodes an ESC/POS receipt and a RawBT link', async () => {
    const sale = await recordSale(ctx, { items: [{ name: 'Bread', qty: 2, price: 800 }], method: 'cash' });
    const bytes = receiptBytes(await book(), { txn: sale }, t, 58);
    expect(bytes[0]).toBe(0x1b); // ESC @ (initialize)
    expect(bytes.length).toBeGreaterThan(50);
    expect(rawbtLink(bytes)).toMatch(/^rawbt:base64,[A-Za-z0-9+/=]+$/);
  });

  it('transliterates Krio for PDF/printer fonts', () => {
    expect(latinSafe('Tɛnki fɔ yu bizines 🎉')).toBe('Tenki fo yu bizines ');
  });
});
