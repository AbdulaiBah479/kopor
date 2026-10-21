// Voice/text entry and receipt scanning.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp, useBook } from '@/state/app';
import { haptic, useOverlay } from '@/ui/overlay';
import { Icon } from '@/ui/Icon';
import { formatMoney } from '@/lib/money';
import { parseLocal, type Parsed } from '@/ai/parser';
import { aiAvailable, aiParse, fixTranscript, scanReceipt, identifyItem, type ScanResult, type ItemGuess } from '@/ai/assistant';
import { bestMatch, matchProduct } from '@/lib/fuzzy';
import { BrowserSpeech, canRecord, startRecording, transcribe, voiceErrorKey, type Recording } from '@/ai/voice';
import { recordSale, recordExpense, EXPENSE_CATEGORIES, METHODS } from '@/domain/cash';
import { recordPurchase, adjustStock, saveProduct } from '@/domain/stock';
import { Field, MoneyInput, Seg } from '@/ui/widgets';
import type { Method } from '@/db/schema';
import { ensureContact, addEntry } from '@/domain/credit';
import { findByName } from '@/domain/book';
import { atomic, update } from '@/db/repo';
import { SaleSheet, ExpenseSheet } from './Cash';
import { NewCreditSheet } from './Credit';

const EXAMPLES = ['Sold 3 bags rice 2550 cash', 'A sɛl tu bag rɛs 1700', 'Aminata tek 2 tin ɔyl 360 pan trɔs', 'Mohamed dɔn pe 250', 'Spent 120 on transport'];

export function VoiceSheet() {
  const { t, i18n } = useTranslation();
  const book = useBook();
  const { ctx, can } = useApp();
  const { closeSheet, openSheet, toast, fail } = useOverlay();
  const [text, setText] = useState('');
  const [voice, setVoice] = useState<'idle' | 'rec' | 'stt' | 'browser'>('idle');
  const [level, setLevel] = useState(0);
  const [secs, setSecs] = useState(0);
  const [fromPrice, setFromPrice] = useState(false);
  const [voiceErr, setVoiceErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Parsed | null>(null);
  const [smart, setSmart] = useState(false);
  const rec = useRef<Recording | null>(null);
  const browserRec = useRef<{ stop: () => void; abort: () => void } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const finishRef = useRef<() => void>(() => {});

  useEffect(() => { aiAvailable().then(setSmart); return () => { rec.current?.cancel(); browserRec.current?.abort(); }; }, []);
  useEffect(() => {
    if (voice !== 'rec') return;
    const id = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [voice]);

  const understand = async (input = text) => {
    if (!input.trim()) return;
    setBusy(true);
    const known = { contacts: book.contacts.map((c) => c.name), products: book.products.map((p) => p.name) };
    let r: Parsed | null = null;
    if (smart && navigator.onLine) { try { r = await aiParse(input, book); } catch { /* the offline parser below always works */ } }
    r ??= parseLocal(input, known);
    // Map what was heard to the real customer and product, forgiving spelling and hearing slips.
    const c = r.name && (findByName(book.contacts, r.name) ?? book.contacts.find((x) => x.name === bestMatch(r!.name, book.contacts.map((y) => y.name))));
    if (c) r.name = c.name;
    if (r.item && !findByName(book.products, r.item)) r.item = bestMatch(r.item, book.products.map((p) => p.name)) ?? r.item;
    if (r.action === 'sale' && r.method === 'credit' && !r.name) r.method = 'cash';
    // Speech-to-text sometimes misses the amount. For a known product, work it out from the price list (shown for checking).
    const p = !r.amount && (r.action === 'sale' || r.action === 'credit_given') && r.item ? findByName(book.products, r.item) : undefined;
    if (p && p.price > 0) r.amount = p.price * (r.qty || 1);
    setFromPrice(!!(p && p.price > 0));
    setResult(r);
    setBusy(false);
  };

  // Fallback: the browser's own speech recognition (Chrome, Edge, Safari) when recording or transcription is unavailable.
  const browserListen = () => {
    if (!BrowserSpeech) return false;
    const r = new BrowserSpeech();
    r.lang = i18n.language === 'fr' ? 'fr-FR' : 'en-GB';
    r.interimResults = true; r.continuous = false;
    let heard = '';
    r.onresult = (e) => { heard = Array.from(e.results).map((x) => x[0].transcript).join(' '); setText(heard); };
    r.onerror = (e) => setVoiceErr(t(voiceErrorKey(new Error(e.error))));
    r.onend = () => { browserRec.current = null; setVoice('idle'); if (heard.trim()) understand(heard); };
    browserRec.current = r;
    setVoiceErr(''); setVoice('browser');
    r.start();
    return true;
  };

  const finish = async () => {
    const current = rec.current;
    if (!current) return;
    rec.current = null;
    setVoice('stt'); setLevel(0);
    try {
      // Customer and product names help Whisper spell them right; the AI then fixes any remaining slips.
      const hints = [...book.contacts.map((c) => c.name), ...book.products.map((p) => p.name)].slice(0, 80).join(', ');
      const { text: first, alt } = await transcribe(await current.stop(), i18n.language, hints);
      const heard = first || alt;
      const said = heard && smart && navigator.onLine ? await fixTranscript(heard, book, 9000, first ? alt : '') : heard;
      if (!said) throw new Error('voice.tooShort');
      setText(said); setResult(null); setVoice('idle');
      haptic(15);
      understand(said);
    } catch (e) {
      setVoice('idle');
      const key = voiceErrorKey(e);
      setVoiceErr(t(key === 'voice.failed' && /limit|busy/i.test(e instanceof Error ? e.message : '') ? 'voice.busy' : key));
    }
  };

  // The 45-second auto-stop timer calls the latest finish().
  useEffect(() => { finishRef.current = finish; });

  const toggleMic = async () => {
    if (voice === 'rec') { finish(); return; }
    if (voice === 'browser') { browserRec.current?.stop(); return; }
    if (voice === 'stt') return;
    setVoiceErr(''); setResult(null);
    // Browsers only allow the microphone on secure pages (https, localhost or the app); explain that plainly.
    if (!window.isSecureContext) { setVoiceErr(t('voice.needHttps')); return; }
    if (!canRecord()) { if (!browserListen()) setVoiceErr(t('voice.unsupported')); return; }
    try {
      rec.current = await startRecording(setLevel, 45, () => finishRef.current());
      setSecs(0); setVoice('rec'); haptic(10);
    } catch (e) {
      const key = voiceErrorKey(e);
      // A blocked or missing microphone will not work through the browser's recogniser either.
      if (key === 'voice.denied' || key === 'voice.noMic' || !browserListen()) setVoiceErr(t(key));
    }
  };
  const saleItems = (r: Parsed) => {
    const p = r.item && findByName(book.products, r.item);
    return p ? [{ product_id: p.id, name: p.name, qty: r.qty || 1, price: r.amount ? Math.round(r.amount / (r.qty || 1)) : p.price }] : [];
  };
  const save = async () => {
    if (!result) return;
    const r = result;
    try {
      let view = '/cash';
      if (r.action === 'sale') await recordSale(ctx, { items: saleItems(r), amount: r.amount, method: r.method, customer: r.name, note: saleItems(r).length ? '' : r.item || r.note });
      else if (r.action === 'purchase' && can('stock') && r.item) {
        // Goods bought to sell again: stock goes up and the cost is recorded as one stock expense.
        await recordPurchase(ctx, { total: r.amount, lines: [{ productId: findByName(book.products, r.item)?.id ?? null, name: r.item, qty: r.qty || 1, unitCost: Math.round(r.amount / (r.qty || 1)) }] });
        view = '/stock';
      } else if (r.action === 'expense' || r.action === 'purchase') await recordExpense(ctx, { amount: r.amount, category: r.action === 'purchase' ? 'stock' : EXPENSE_CATEGORIES.includes(r.category as never) ? r.category : 'other', note: r.note || r.item });
      else {
        if (!r.name) { openSheet(t('credit.addEntry'), <NewCreditSheet type={r.action === 'payment_received' ? 'got' : 'gave'} amount={r.amount} />); return; }
        await atomic(async () => {
          const c = await ensureContact(ctx, r.name);
          await addEntry(ctx, { contactId: c.id, type: r.action === 'credit_given' ? 'gave' : 'got', amount: r.amount, note: r.note || (r.item ? `${r.qty} ${r.item}` : '') });
        });
        view = '/credit';
      }
      closeSheet(); toast(t('common.saved'), { view });
    } catch (e) { fail(e); }
  };
  const edit = () => {
    const r = result!;
    if (r.action === 'sale') openSheet(t('cash.newSale'), <SaleSheet prefill={{ items: saleItems(r), amount: r.amount, method: r.method, customer: r.name, note: r.item }} />);
    else if (r.action === 'purchase') openSheet(t('ai.scanTitle'), <ScanSheet prefill={{ kind: 'purchase', vendor: '', date: '', category: 'stock', total: r.amount,
      items: [{ name: r.item || r.note, qty: r.qty || 1, price: Math.round(r.amount / (r.qty || 1)) }] }} />);
    else if (r.action === 'expense') openSheet(t('cash.newExpense'), <ExpenseSheet prefill={{ amount: r.amount, category: r.category, note: r.note }} />);
    else openSheet(t('credit.addEntry'), <NewCreditSheet name={r.name} type={r.action === 'payment_received' ? 'got' : 'gave'} amount={r.amount} note={r.note} />);
  };

  const valid = result && result.action !== 'unknown' && result.amount > 0;
  return (
    <form className="form" ref={formRef} data-testid="voice-form" onSubmit={(e) => { e.preventDefault(); understand(); }}>
      <div className="small muted">{t('ai.speakHelp')}</div>
      <div className="voice-mic" data-autofocus-off>
        <button type="button" className={`mic-btn ${voice}`} onClick={toggleMic} data-testid="mic"
          style={{ '--lvl': level } as React.CSSProperties} aria-pressed={voice === 'rec' || voice === 'browser'}
          aria-label={voice === 'rec' || voice === 'browser' ? t('voice.stop') : t('voice.tap')}>
          <Icon name={voice === 'rec' || voice === 'browser' ? 'stop' : 'mic'} size={34} strokeWidth={2.2} />
        </button>
        <div className="mic-status" role="status" aria-live="polite">
          {voice === 'rec' ? <>{t('voice.recording')} <span className="num">{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</span></>
            : voice === 'browser' ? t('voice.recording')
            : voice === 'stt' ? t('voice.transcribing') : t('voice.tap')}
        </div>
        {voiceErr && <div className="alert small" role="alert"><Icon name="alert" /><div>{voiceErr}</div></div>}
      </div>
      <label className="small muted" htmlFor="voice-text">{t('voice.orType')}</label>
      <textarea id="voice-text" name="text" required value={text} placeholder={t('ai.placeholder')} onChange={(e) => { setText(e.target.value); setResult(null); }} />
      <div className="chips">{EXAMPLES.map((ex) => <button type="button" key={ex} className="chip" onClick={() => { setText(ex); setResult(null); }}>{ex}</button>)}</div>
      <button className="btn primary block" disabled={busy || voice === 'stt'}><Icon name="spark" size={18} /> {busy ? t('ai.thinking') : t('ai.understand')}</button>
      <div className="small muted">{smart ? t('ai.smartMode') : t('ai.offlineMode')}</div>
      {result && (valid ? (
        <div className="card flat stack" data-testid="ai-preview">
          {([
            [t('common.type'), t(`ai.actions.${result.action}`)], [t('common.amount'), formatMoney(result.amount)],
            result.name && [t('ai.person'), result.name], result.item && [t('common.item'), `${result.qty} × ${result.item}`],
            result.action === 'sale' && [t('cash.method'), t(`methods.${result.method}`)], result.action === 'expense' && [t('cash.category'), t(`categories.${result.category}`)],
          ].filter(Boolean) as [string, string][]).map(([k, v]) => <div key={k} className="row between"><span className="muted">{k}</span><b>{v}</b></div>)}
          {result.action === 'purchase' && <div className="small muted">{t(can('stock') ? 'aix.purchaseHelp' : 'aix.purchaseCashier')}</div>}
          {fromPrice && <div className="small muted" data-testid="from-price">{t('ai.fromPrice')}</div>}
          <div className="btn-row">
            <button type="button" className="btn" onClick={edit}><Icon name="edit" size={18} /> {t('common.edit')}</button>
            <button type="button" className="btn primary" onClick={save} data-testid="ai-save"><Icon name="check" size={18} /> {t('common.save')}</button>
          </div>
        </div>
      ) : <div className="alert"><Icon name="alert" /><div>{t('ai.notSure')}</div></div>)}
    </form>
  );
}

/** Downscale a photo before sending it to the AI (saves data on slow networks). */
async function toDataUrl(file: File, max = 1280): Promise<string> {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * scale), height: Math.round(img.height * scale) });
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.8);
}

interface ScanRow { name: string; productId: string; qty: number; price: number; sellPrice: number }
type ScanMode = 'purchase' | 'sale' | 'expense';

/**
 * Photo of a receipt, supplier bill or handwritten page (no barcode needed) → checked lines → saved in one step as
 * goods bought (stock in + one expense), a sale (stock out) or an expense.
 */
export function ScanSheet({ prefill, prefer }: { prefill?: ScanResult; prefer?: 'purchase' | 'sale' } = {}) {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx, can } = useApp();
  const { closeSheet, toast, fail } = useOverlay();
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<ScanResult | null>(prefill ?? null);
  const [rows, setRows] = useState<ScanRow[]>(() => (prefill?.items ?? []).map((i) => ({ name: i.name, productId: findByName(book.products, i.name)?.id ?? '', qty: i.qty, price: i.price, sellPrice: i.price })));
  const [mode, setMode] = useState<ScanMode>(prefill?.kind ?? 'purchase');
  const [total, setTotal] = useState(prefill?.total ?? 0);
  const [supplier, setSupplier] = useState('');
  const [method, setMethod] = useState<Method>('cash');
  const [category, setCategory] = useState('other');
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => { aiAvailable().then(setOk); }, []);
  const names = book.products.map((p) => p.name);
  // Strict matching: a wrong match would add stock to the wrong product, so unsure lines become new products to check.
  const matchId = (name: string) => (findByName(book.products, name) ?? book.products.find((x) => x.name === matchProduct(name, names)))?.id ?? '';

  const pick = async (file?: File) => {
    if (!file) return;
    try {
      setBusy(true); setRes(null); setRows([]);
      const url = await toDataUrl(file, 1600);
      setPreview(url);
      const r = await scanReceipt(url, names);
      setRes(r);
      setRows(r.items.map((i) => { const id = matchId(i.name); return { name: book.products.find((p) => p.id === id)?.name ?? i.name, productId: id, qty: i.qty || 1, price: i.price, sellPrice: i.price }; }));
      setTotal(r.total);
      setSupplier(r.vendor);
      setCategory(EXPENSE_CATEGORIES.includes(r.category as never) ? r.category : 'other');
      const kind = prefer && r.items.length && (prefer !== 'purchase' || can('stock')) ? prefer : r.kind;
      setMode(!r.items.length || (kind === 'purchase' && !can('stock')) ? 'expense' : kind);
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const set = (k: number, patch: Partial<ScanRow>) => setRows(rows.map((r, i) => (i === k ? { ...r, ...patch } : r)));
  const lineSum = rows.reduce((s, r) => s + r.qty * r.price, 0);
  const newCount = rows.filter((r) => r.name.trim() && !r.productId).length;
  const date = res?.date && /^\d{4}-\d{2}-\d{2}$/.test(res.date) ? res.date : undefined;

  const save = async () => {
    try {
      if (mode === 'purchase') {
        await recordPurchase(ctx, { supplier, total: total || lineSum, method, date,
          lines: rows.map((r) => ({ productId: r.productId || null, name: r.name, qty: r.qty, unitCost: r.price, sellPrice: r.sellPrice })) });
        toast(t('rscan.savedPurchase'), { view: '/stock' });
      } else if (mode === 'sale') {
        await recordSale(ctx, { items: rows.filter((r) => r.name.trim()).map((r) => ({ product_id: r.productId || null, name: r.name, qty: r.qty, price: r.price })), method, date, note: supplier });
        toast(t('rscan.savedSale'), { view: '/cash' });
      } else {
        await recordExpense(ctx, { amount: total || lineSum, category, method, date, note: supplier || rows.map((r) => r.name).join(', ') });
        toast(t('rscan.savedExpense'), { view: '/cash' });
      }
      haptic(15);
      closeSheet();
    } catch (e) { fail(e); }
  };

  if (ok === false) return <div className="alert"><Icon name="alert" /><div>{t('ai.needAi')}</div></div>;
  return (
    <div className="stack" data-testid="scan-sheet">
      <div className="small muted">{t('ai.scanHelp')}</div>
      <label className="btn primary block"><Icon name="camera" size={18} /> {t('ai.takePhoto')}
        <input type="file" accept="image/*" capture="environment" hidden data-testid="scan-file" onChange={(e) => pick(e.target.files?.[0])} /></label>
      {preview && <img className="scan-preview" src={preview} alt="" />}
      {busy && <div className="muted small" role="status">{t('ai.reading')}</div>}
      {res && !rows.length && <div className="alert small"><Icon name="alert" /><div>{t('rscan.nothing')}</div></div>}
      {res && (
        <div className="stack form" data-testid="scan-review">
          <Seg<ScanMode> value={mode} onChange={setMode} options={[
            ...(can('stock') ? [['purchase', t('rscan.bought')] as [ScanMode, string]] : []), ['sale', t('rscan.sold')], ['expense', t('rscan.expenseOnly')]]} />
          {!can('stock') && <div className="small muted">{t('rscan.managerOnly')}</div>}
          <div className="small muted">{t('rscan.check')}</div>
          {mode !== 'expense' && rows.map((r, k) => (
            <div key={k} className="card flat stack" data-testid="scan-row">
              <div className="row between" style={{ gap: 8 }}>
                <input className="input" aria-label={t('rscan.item')} value={r.name} onChange={(e) => set(k, { name: e.target.value, productId: matchId(e.target.value) })} />
                <button type="button" className="icon-btn" aria-label={t('common.delete')} onClick={() => setRows(rows.filter((_, i) => i !== k))}><Icon name="trash" size={18} /></button>
              </div>
              <select aria-label={t('rscan.product')} value={r.productId} onChange={(e) => { const p = book.products.find((x) => x.id === e.target.value); set(k, { productId: e.target.value, ...(p ? { name: p.name } : {}) }); }}>
                <option value="">{t('rscan.newProduct')}</option>
                {book.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <div className="grid2">
                <Field label={t('rscan.qty')}><input type="number" inputMode="decimal" min="0" step="any" value={r.qty || ''} onChange={(e) => set(k, { qty: Number(e.target.value) || 0 })} /></Field>
                <Field label={t(mode === 'purchase' ? 'rscan.unitCost' : 'rscan.unitPrice')}><MoneyInput value={r.price} onChange={(price) => set(k, { price })} /></Field>
              </div>
              {mode === 'purchase' && !r.productId && <Field label={t('rscan.sellPrice')}><MoneyInput value={r.sellPrice} onChange={(sellPrice) => set(k, { sellPrice })} /></Field>}
            </div>
          ))}
          {mode !== 'expense' && <button type="button" className="btn ghost block" onClick={() => setRows([...rows, { name: '', productId: '', qty: 1, price: 0, sellPrice: 0 }])}><Icon name="plus" size={18} /> {t('rscan.addLine')}</button>}
          {mode === 'purchase' && newCount > 0 && <div className="small muted">{t('rscan.newCount', { n: newCount })}</div>}
          {mode !== 'sale' && <Field label={t(mode === 'purchase' ? 'rscan.supplier' : 'rscan.note')}><input value={supplier} onChange={(e) => setSupplier(e.target.value)} /></Field>}
          {mode === 'expense' && <Field label={t('cash.category')}><select value={category} onChange={(e) => setCategory(e.target.value)}>{EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{t(`categories.${c}`)}</option>)}</select></Field>}
          <Field label={t('cash.paidWith')}><select value={method} onChange={(e) => setMethod(e.target.value as Method)}>{METHODS.filter((m) => m !== 'credit').map((m) => <option key={m} value={m}>{t(`methods.${m}`)}</option>)}</select></Field>
          {mode !== 'sale'
            ? <Field label={t('rscan.total')}><MoneyInput value={total || lineSum} onChange={setTotal} /></Field>
            : <div className="row between"><b>{t('common.total')}</b><b className="num">{formatMoney(lineSum)}</b></div>}
          <button type="button" className="btn primary block" data-testid="scan-save" disabled={busy} onClick={save}><Icon name="check" size={18} /> {t('rscan.save')}</button>
        </div>
      )}
    </div>
  );
}

type Detector = { detect: (s: ImageBitmapSource) => Promise<{ rawValue: string }[]> };
const NativeBarcode = (window as unknown as { BarcodeDetector?: new () => Detector }).BarcodeDetector;

/**
 * Point the camera at an item (no receipt needed): a known barcode is matched instantly (no AI, works offline);
 * otherwise the AI recognises the product from its packaging. Then one tap: add to stock, sell, or create the product.
 */
export function ItemScanSheet({ prefer }: { prefer?: 'stock' | 'sale' } = {}) {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx, can } = useApp();
  const { openSheet, closeSheet, toast, fail } = useOverlay();
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [guess, setGuess] = useState<ItemGuess | null>(null);
  const [code, setCode] = useState('');
  const [f, setF] = useState({ productId: '', name: '', qty: 1, price: 0, cost: 0, paid: true });
  const names = book.products.map((p) => p.name);
  const product = book.products.find((p) => p.id === f.productId);

  const pick = async (file?: File) => {
    if (!file) return;
    setBusy(true); setGuess(null); setCode('');
    try {
      const url = await toDataUrl(file, 1280);
      setPreview(url);
      // 1) A barcode the shop already knows: instant, offline.
      const found = NativeBarcode ? (await new NativeBarcode().detect(await createImageBitmap(file)).catch(() => []))[0]?.rawValue ?? '' : '';
      setCode(found);
      const bySku = found ? book.products.find((p) => p.sku && p.sku === found) : undefined;
      if (bySku) {
        setGuess({ name: bySku.name, brand: '', size: '', barcode: found, match: bySku.name, confidence: 1 });
        setF({ productId: bySku.id, name: bySku.name, qty: 1, price: bySku.price, cost: bySku.cost, paid: true });
        return;
      }
      // 2) Otherwise the AI looks at the packaging.
      const g = await identifyItem(url, names);
      setGuess(g);
      if (!found && /^\d{6,14}$/.test(g.barcode)) setCode(g.barcode);
      const p = (g.match && findByName(book.products, g.match)) || book.products.find((x) => x.name === matchProduct(g.name, names));
      setF({ productId: p?.id ?? '', name: p?.name ?? g.name, qty: 1, price: p?.price ?? 0, cost: p?.cost ?? 0, paid: true });
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  /** Remember the barcode on the product, so the next scan is instant and offline. */
  const rememberBarcode = async (id: string) => {
    const p = book.products.find((x) => x.id === id);
    if (code && p && !p.sku && can('stock')) await update(ctx, 'products', id, { sku: code }, `Barcode for ${p.name}`);
  };
  const addToStock = async () => {
    try {
      if (product) {
        await adjustStock(ctx, product.id, f.qty, { recordExpense: f.paid, unitCost: f.cost || product.cost });
        await rememberBarcode(product.id);
      } else {
        await saveProduct(ctx, { name: f.name.trim(), sku: code, unit: 'pcs', price: f.price, cost: f.cost, low_at: 0, opening: f.qty });
        if (f.paid && f.cost > 0) await recordExpense(ctx, { amount: f.cost * f.qty, category: 'stock', note: `${f.qty} ${f.name.trim()}` });
      }
      closeSheet(); haptic(15);
      toast(t('item.stockAdded', { qty: f.qty, name: product?.name ?? f.name.trim() }), { view: '/stock' });
    } catch (e) { fail(e); }
  };
  const sell = async () => {
    if (product) await rememberBarcode(product.id).catch(() => {});
    openSheet(t('cash.newSale'), <SaleSheet prefill={{ items: [{ product_id: product?.id ?? null, name: product?.name ?? f.name, qty: f.qty, price: product?.price ?? f.price }] }} />);
  };

  return (
    <div className="stack" data-testid="item-scan">
      <div className="small muted">{t('item.help')}</div>
      <label className="btn primary block"><Icon name="camera" size={18} /> {t('item.take')}
        <input type="file" accept="image/*" capture="environment" hidden data-testid="item-file" onChange={(e) => pick(e.target.files?.[0])} /></label>
      {preview && <img className="scan-preview" src={preview} alt="" />}
      {busy && <div className="muted small" role="status">{t('item.looking')}</div>}
      {guess && (
        <div className="card flat stack form" data-testid="item-result">
          <div><span className="small muted">{t('item.looksLike')}</span> <b>{guess.name || '—'}</b>{code && <span className="small muted"> · {code}</span>}</div>
          {guess.confidence < 0.5 && <div className="alert small"><Icon name="alert" /><div>{t('item.unsure')}</div></div>}
          <select aria-label={t('rscan.product')} value={f.productId} onChange={(e) => {
            const p = book.products.find((x) => x.id === e.target.value);
            setF({ ...f, productId: e.target.value, name: p?.name ?? guess.name, price: p?.price ?? f.price, cost: p?.cost ?? f.cost });
          }}>
            <option value="">{t('rscan.newProduct')}</option>
            {book.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {!product && <Field label={t('item.name')}><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>}
          <div className="grid2">
            <Field label={t('rscan.qty')}><input type="number" inputMode="decimal" min="1" step="any" value={f.qty || ''} onChange={(e) => setF({ ...f, qty: Number(e.target.value) || 0 })} /></Field>
            {!product && <Field label={t('rscan.sellPrice')}><MoneyInput value={f.price} onChange={(price) => setF({ ...f, price })} /></Field>}
          </div>
          {can('stock') && (
            <>
              <Field label={t('item.cost')}><MoneyInput value={f.cost} onChange={(cost) => setF({ ...f, cost })} /></Field>
              <label className="row small" style={{ gap: 8, alignItems: 'center', justifyContent: 'flex-start' }}><input type="checkbox" checked={f.paid} onChange={(e) => setF({ ...f, paid: e.target.checked })} /> {t('item.paid')}</label>
            </>
          )}
          <div className="btn-row">
            {can('stock') && <button type="button" className={`btn ${prefer === 'sale' ? '' : 'primary'}`} data-testid="item-stock" disabled={!(f.qty > 0) || (!product && !f.name.trim())} onClick={addToStock}><Icon name="box" size={18} /> {t('item.addStock')}</button>}
            {can('record') && <button type="button" className={`btn ${prefer === 'sale' || !can('stock') ? 'primary' : 'get'}`} data-testid="item-sell" disabled={!(f.qty > 0)} onClick={sell}><Icon name="bag" size={18} /> {t('item.sell')}</button>}
          </div>
        </div>
      )}
    </div>
  );
}
