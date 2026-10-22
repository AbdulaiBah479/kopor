import { describe, expect, it } from 'vitest';
import { parseReceiptText } from '@/ai/ocrReceipt';

describe('offline receipt reading (text from on-phone OCR)', () => {
  it('reads quantity × price lines, the total, and the shop name', () => {
    const r = parseReceiptText(`KISSY ROAD WHOLESALE
Kissy Road, Freetown 076 555 222
CASH RECEIPT 0457
RICE 50KG BAG 2 x 720 1,440
SUGAR 1KG 10 x 25 250
CANDLES BOX 3 x 40 120
TOTAL Le 1,810
Thank you`);
    expect(r.vendor).toBe('KISSY ROAD WHOLESALE');
    expect(r.items).toEqual([
      { name: 'Rice 50kg Bag', qty: 2, price: 72000 },
      { name: 'Sugar 1kg', qty: 10, price: 2500 },
      { name: 'Candles Box', qty: 3, price: 4000 },
    ]);
    expect(r.total).toBe(181000);
  });

  it('reads other common layouts and skips tax, change and phone lines', () => {
    const r = parseReceiptText(`Mama Fatu Store
Palm oil 4L 2 180 360
3 Soap bar 36
Bread 8.50
Subtotal 404.50
VAT 15% 60.68
Cash 500
Change 95.50
Tel 076123456`);
    expect(r.items).toEqual([
      { name: 'Palm oil 4L', qty: 2, price: 18000 },
      { name: 'Soap bar', qty: 3, price: 1200 },
      { name: 'Bread', qty: 1, price: 850 },
    ]);
    expect(r.total).toBe(36000 + 3600 + 850);   // no "total" line: the sum of the lines
  });
});
