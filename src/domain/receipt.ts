// Receipts anyone can check. Each sale's receipt carries a code (the first 12 characters of the sale's id, which
// nobody can guess) and a link; opening it shows the shop, the amount, the date and whether the sale still stands,
// straight from Kopor's server. A faked or edited receipt screenshot does not match.
import type { Txn } from '@/db/schema';
import { itemsLabel } from './cash';

/** "3F2A-9C1B-77D0": easy to read out, type or compare. */
export const receiptCode = (txnId: string) => txnId.replace(/-/g, '').slice(0, 12).toUpperCase().replace(/(.{4})(?=.)/g, '$1-');
/** The 12 hex characters from anything typed or scanned (spaces, dashes, lower case), or null. */
export const cleanCode = (s: string) => { const k = s.replace(/[^0-9a-f]/gi, '').toLowerCase(); return k.length === 12 ? k : null; };
export const receiptLink = (base: string, txnId: string) => `${base.replace(/\/?$/, '/')}#/r/${receiptCode(txnId)}`;

/** The text sent to a customer by WhatsApp or SMS. */
export function receiptMessage(t: (k: string, o?: Record<string, unknown>) => string, shop: string, txn: Txn, money: (n: number) => string, link: string) {
  return t('rcpt.msg', { shop, items: itemsLabel(txn.items) || txn.note || t('categories.sale'), amount: money(txn.amount), date: txn.date, code: receiptCode(txn.id), link });
}
