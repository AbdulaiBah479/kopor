// Thermal receipt printing (58mm / 80mm ESC/POS printers, very common in Sierra Leone shops).
// Encoding: @point-of-sale/receipt-printer-encoder. Transports, best first:
//   1. Android app: Bluetooth LE via @capacitor-community/bluetooth-le
//   2. Chrome on Android/desktop: Web Bluetooth (BLE printers)
//   3. Classic-Bluetooth printers: the free RawBT app (rawbt: link) prints the same bytes
import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder';
import { Capacitor } from '@capacitor/core';
import type { Invoice, Txn } from '@/db/schema';
import type { Book } from '@/domain/book';
import { getMeta, setMeta } from '@/db/repo';
import { formatMoney } from '@/lib/money';
import { fmtDate } from '@/lib/dates';
import { itemsTotal } from '@/domain/cash';
import { invoiceCode, invoiceTotal } from '@/domain/invoices';
import { latinSafe as pdfSafe } from '@/lib/text';

export interface PrinterSettings { width: 58 | 80; mode: 'ble' | 'rawbt'; deviceId?: string; deviceName?: string }
export const getPrinter = () => getMeta<PrinterSettings>('printer', { width: 58, mode: 'ble' });
export const savePrinter = (p: PrinterSettings) => setMeta('printer', p);

type T = (k: string, o?: Record<string, unknown>) => string;

// Common GATT services exposed by cheap BLE thermal printers.
const SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '0000ff00-0000-1000-8000-00805f9b34fb', '0000fee7-0000-1000-8000-00805f9b34fb', '0000ae30-0000-1000-8000-00805f9b34fb',
];

/** Build ESC/POS bytes for a sale/refund or an invoice. */
export function receiptBytes(book: Book, doc: { txn?: Txn; invoice?: Invoice }, t: T, width: 58 | 80 = 58): Uint8Array {
  const columns = width === 80 ? 48 : 32;
  const o = book.org;
  const items = doc.invoice?.items ?? doc.txn?.items ?? [];
  const total = doc.invoice ? invoiceTotal(doc.invoice) : doc.txn?.amount ?? 0;
  const discount = doc.invoice?.discount ?? doc.txn?.discount ?? 0;
  const tax = doc.invoice?.tax ?? doc.txn?.tax ?? 0;
  const date = doc.invoice?.date ?? doc.txn?.date ?? '';
  const refund = doc.txn?.category === 'refund';
  const m = (v: number) => pdfSafe(formatMoney(v));

  const e = new ReceiptPrinterEncoder({ language: 'esc-pos', columns });
  e.initialize().codepage('cp437').align('center')
    .bold(true).size(2, 2).line(pdfSafe(o.name).slice(0, columns / 2)).size(1, 1).bold(false);
  for (const l of [o.address, o.phone, o.tax_id ? `TIN ${o.tax_id}` : ''].filter(Boolean)) e.line(pdfSafe(l!));
  e.newline().bold(true).line(pdfSafe(refund ? t('returns.refund').toUpperCase() : doc.invoice ? `${t(doc.invoice.status === 'paid' ? 'inv.receipt' : 'inv.invoice')} ${doc.invoice.number}` : t('inv.receipt'))).bold(false)
    .line(pdfSafe(fmtDate(date))).align('left').rule();
  const amountW = 11;
  e.table(
    [{ width: columns - amountW - 1, marginRight: 1, align: 'left' }, { width: amountW, align: 'right' }],
    items.length ? items.map((i) => [pdfSafe(`${i.qty} x ${i.name}`), m(i.qty * i.price)]) : [[pdfSafe(doc.txn?.note || t('categories.sale')), m(total)]],
  );
  e.rule();
  const row = (label: string, value: string) => e.table([{ width: columns - amountW - 1, marginRight: 1, align: 'left' }, { width: amountW, align: 'right' }], [[pdfSafe(label), value]]);
  if (discount || tax) row(t('tax.subtotal'), m(itemsTotal(items)));
  if (discount) row(t('tax.discount'), `-${m(discount)}`);
  if (tax) row(t('tax.tax'), m(tax));
  e.bold(true);
  row(t('common.total'), m(total));
  e.bold(false);
  if (doc.txn) row(t('cash.method'), pdfSafe(t(`methods.${doc.txn.method}`)));
  e.newline().align('center');
  if (doc.invoice) e.line(pdfSafe(`${t('inv.verify')}: ${invoiceCode(o.name, doc.invoice)}`));
  if (o.momo_number && doc.invoice?.status === 'unpaid') e.line(pdfSafe(`${t('inv.payMomo')}: ${o.momo_number}`));
  e.line(pdfSafe(o.receipt_footer || t('printer.thanks'))).line('Kopor').newline(3).cut();
  return e.encode();
}

/* ---------- Transports ---------- */
interface BleCharacteristic { properties: { write: boolean; writeWithoutResponse: boolean }; writeValueWithoutResponse?: (d: BufferSource) => Promise<void>; writeValue: (d: BufferSource) => Promise<void> }
interface BleService { getCharacteristics: () => Promise<BleCharacteristic[]> }
interface BleDevice { id: string; name?: string; gatt: { connected: boolean; connect: () => Promise<{ getPrimaryService: (u: string) => Promise<BleService> }> } }
type WebBluetooth = { requestDevice: (o: unknown) => Promise<BleDevice>; getDevices?: () => Promise<BleDevice[]> };
const webBt = () => (navigator as unknown as { bluetooth?: WebBluetooth }).bluetooth;

let webDevice: BleDevice | null = null;

export const printingSupport = () => ({ native: Capacitor.isNativePlatform(), web: !!webBt(), rawbt: /android/i.test(navigator.userAgent) });

/** Ask the user to choose a printer (must be called from a tap). */
export async function pairPrinter(): Promise<{ id: string; name: string }> {
  if (Capacitor.isNativePlatform()) {
    const { BleClient } = await import('@capacitor-community/bluetooth-le');
    await BleClient.initialize();
    const d = await BleClient.requestDevice({ optionalServices: SERVICES });
    return { id: d.deviceId, name: d.name ?? 'Printer' };
  }
  const bt = webBt();
  if (!bt) throw new Error('errx.noBluetooth');
  webDevice = await bt.requestDevice({ acceptAllDevices: true, optionalServices: SERVICES });
  return { id: webDevice.id, name: webDevice.name ?? 'Printer' };
}

async function writeWeb(data: Uint8Array, deviceId?: string) {
  const bt = webBt();
  if (!bt) throw new Error('errx.noBluetooth');
  if (!webDevice && deviceId && bt.getDevices) webDevice = (await bt.getDevices()).find((d) => d.id === deviceId) ?? null;
  if (!webDevice) webDevice = await bt.requestDevice({ acceptAllDevices: true, optionalServices: SERVICES });
  const server = await webDevice.gatt.connect();
  for (const uuid of SERVICES) {
    try {
      const chars = await (await server.getPrimaryService(uuid)).getCharacteristics();
      const c = chars.find((x) => x.properties.writeWithoutResponse || x.properties.write);
      if (!c) continue;
      for (let i = 0; i < data.length; i += 180) {
        const chunk = data.slice(i, i + 180);
        if (c.properties.writeWithoutResponse && c.writeValueWithoutResponse) await c.writeValueWithoutResponse(chunk); else await c.writeValue(chunk);
      }
      return;
    } catch { /* try the next known service */ }
  }
  throw new Error('errx.printerService');
}

async function writeNative(data: Uint8Array, deviceId: string) {
  const { BleClient } = await import('@capacitor-community/bluetooth-le');
  await BleClient.initialize();
  await BleClient.connect(deviceId);
  try {
    const services = await BleClient.getServices(deviceId);
    for (const s of services) {
      const c = s.characteristics.find((x) => x.properties.writeWithoutResponse || x.properties.write);
      if (!c) continue;
      for (let i = 0; i < data.length; i += 180) {
        const chunk = data.slice(i, i + 180);
        const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        if (c.properties.writeWithoutResponse) await BleClient.writeWithoutResponse(deviceId, s.uuid, c.uuid, view);
        else await BleClient.write(deviceId, s.uuid, c.uuid, view);
      }
      return;
    }
    throw new Error('errx.printerService');
  } finally { await BleClient.disconnect(deviceId).catch(() => {}); }
}

/** RawBT (free Android app) prints to classic-Bluetooth printers that BLE cannot reach. */
export function rawbtLink(data: Uint8Array) {
  let bin = '';
  for (let i = 0; i < data.length; i++) bin += String.fromCharCode(data[i]);
  return `rawbt:base64,${btoa(bin)}`;
}

export async function printBytes(data: Uint8Array) {
  const p = await getPrinter();
  if (p.mode === 'rawbt') { window.location.href = rawbtLink(data); return; }
  if (Capacitor.isNativePlatform()) {
    if (!p.deviceId) throw new Error('errx.noPrinter');
    return writeNative(data, p.deviceId);
  }
  return writeWeb(data, p.deviceId);
}
