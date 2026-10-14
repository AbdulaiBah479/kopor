// Voice/text entry and receipt scanning.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp, useBook } from '@/state/app';
import { useOverlay } from '@/ui/overlay';
import { Icon } from '@/ui/Icon';
import { formatMoney } from '@/lib/money';
import { parseLocal, type Parsed } from '@/ai/parser';
import { aiAvailable, aiParse, scanReceipt, type ScanResult } from '@/ai/assistant';
import { recordSale, recordExpense, EXPENSE_CATEGORIES } from '@/domain/cash';
import { ensureContact, addEntry } from '@/domain/credit';
import { findByName } from '@/domain/book';
import { atomic } from '@/db/repo';
import { SaleSheet, ExpenseSheet } from './Cash';
import { NewCreditSheet } from './Credit';

type SR = { lang: string; interimResults: boolean; start: () => void; stop: () => void; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onerror: (e: { error: string }) => void; onend: () => void };
const SpeechRecognition = (window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }).SpeechRecognition
  ?? (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition;

const EXAMPLES = ['Sold 3 bags rice 2550 cash', 'Aminata took 2 tins oil 360 on credit', 'Mohamed don pay 250', 'Spent 120 on transport'];

export function VoiceSheet() {
  const { t, i18n } = useTranslation();
  const book = useBook();
  const { ctx } = useApp();
  const { closeSheet, openSheet, toast, fail } = useOverlay();
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Parsed | null>(null);
  const [smart, setSmart] = useState(false);
  const rec = useRef<SR | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => { aiAvailable().then(setSmart); return () => rec.current?.stop(); }, []);

  const understand = async (input = text) => {
    if (!input.trim()) return;
    setBusy(true);
    const known = { contacts: book.contacts.map((c) => c.name), products: book.products.map((p) => p.name) };
    let r: Parsed | null = null;
    if (smart) { try { r = await aiParse(input, book); } catch { toast(t('ai.fallback')); } }
    r ??= parseLocal(input, known);
    const c = r.name && findByName(book.contacts, r.name);
    if (c) r.name = c.name;
    if (r.action === 'sale' && r.method === 'credit' && !r.name) r.method = 'cash';
    setResult(r);
    setBusy(false);
  };

  const listen = () => {
    if (!SpeechRecognition) return;
    if (rec.current) { rec.current.stop(); return; }
    const r = new SpeechRecognition();
    r.lang = i18n.language === 'fr' ? 'fr-FR' : 'en-GB';
    r.interimResults = true;
    let finalText = '';
    r.onresult = (e) => { finalText = Array.from(e.results).map((x) => x[0].transcript).join(' '); setText(finalText); };
    r.onerror = (e) => toast(e.error === 'not-allowed' ? t('ai.micDenied') : t('ai.heard'));
    r.onend = () => { rec.current = null; setListening(false); if (finalText.trim()) understand(finalText); };
    rec.current = r;
    setListening(true);
    r.start();
  };

  const saleItems = (r: Parsed) => {
    const p = r.item && findByName(book.products, r.item);
    return p ? [{ product_id: p.id, name: p.name, qty: r.qty || 1, price: r.amount ? Math.round(r.amount / (r.qty || 1)) : p.price }] : [];
  };
  const save = async () => {
    if (!result) return;
    const r = result;
    try {
      if (r.action === 'sale') await recordSale(ctx, { items: saleItems(r), amount: r.amount, method: r.method, customer: r.name, note: saleItems(r).length ? '' : r.item || r.note });
      else if (r.action === 'expense') await recordExpense(ctx, { amount: r.amount, category: EXPENSE_CATEGORIES.includes(r.category as never) ? r.category : 'other', note: r.note || r.item });
      else {
        if (!r.name) { openSheet(t('credit.addEntry'), <NewCreditSheet type={r.action === 'payment_received' ? 'got' : 'gave'} amount={r.amount} />); return; }
        await atomic(async () => {
          const c = await ensureContact(ctx, r.name);
          await addEntry(ctx, { contactId: c.id, type: r.action === 'credit_given' ? 'gave' : 'got', amount: r.amount, note: r.note || (r.item ? `${r.qty} ${r.item}` : '') });
        });
      }
      closeSheet(); toast(t('common.saved'));
    } catch (e) { fail(e); }
  };
  const edit = () => {
    const r = result!;
    if (r.action === 'sale') openSheet(t('cash.newSale'), <SaleSheet prefill={{ items: saleItems(r), amount: r.amount, method: r.method, customer: r.name, note: r.item }} />);
    else if (r.action === 'expense') openSheet(t('cash.newExpense'), <ExpenseSheet prefill={{ amount: r.amount, category: r.category, note: r.note }} />);
    else openSheet(t('credit.addEntry'), <NewCreditSheet name={r.name} type={r.action === 'payment_received' ? 'got' : 'gave'} amount={r.amount} note={r.note} />);
  };

  const valid = result && result.action !== 'unknown' && result.amount > 0;
  return (
    <form className="form" ref={formRef} data-testid="voice-form" onSubmit={(e) => { e.preventDefault(); understand(); }}>
      <div className="small muted">{t('ai.speakHelp')}</div>
      <textarea name="text" required value={text} placeholder={t('ai.placeholder')} onChange={(e) => { setText(e.target.value); setResult(null); }} />
      <div className="chips">{EXAMPLES.map((ex) => <button type="button" key={ex} className="chip" onClick={() => { setText(ex); setResult(null); }}>{ex}</button>)}</div>
      <div className="btn-row">
        {SpeechRecognition && <button type="button" className={`btn ${listening ? 'primary' : ''}`} onClick={listen}><Icon name="mic" size={18} /> {listening ? t('ai.listening') : t('ai.listen')}</button>}
        <button className="btn primary" disabled={busy}><Icon name="spark" size={18} /> {busy ? t('ai.thinking') : t('ai.understand')}</button>
      </div>
      <div className="small muted">{smart ? t('ai.smartMode') : t('ai.offlineMode')}</div>
      {result && (valid ? (
        <div className="card flat stack" data-testid="ai-preview">
          {([
            [t('common.type'), t(`ai.actions.${result.action}`)], [t('common.amount'), formatMoney(result.amount)],
            result.name && [t('ai.person'), result.name], result.item && [t('common.item'), `${result.qty} × ${result.item}`],
            result.action === 'sale' && [t('cash.method'), t(`methods.${result.method}`)], result.action === 'expense' && [t('cash.category'), t(`categories.${result.category}`)],
          ].filter(Boolean) as [string, string][]).map(([k, v]) => <div key={k} className="row between"><span className="muted">{k}</span><b>{v}</b></div>)}
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

export function ScanSheet() {
  const { t } = useTranslation();
  const { openSheet, fail } = useOverlay();
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<ScanResult | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => { aiAvailable().then(setOk); }, []);

  const pick = async (file?: File) => {
    if (!file) return;
    try {
      setBusy(true); setRes(null);
      const url = await toDataUrl(file);
      setPreview(url);
      setRes(await scanReceipt(url));
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  if (ok === false) return <div className="alert"><Icon name="alert" /><div>{t('ai.needAi')}</div></div>;
  return (
    <div className="stack">
      <div className="small muted">{t('ai.scanHelp')}</div>
      <label className="btn primary block"><Icon name="camera" size={18} /> {t('ai.takePhoto')}
        <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => pick(e.target.files?.[0])} /></label>
      {preview && <img className="scan-preview" src={preview} alt="" />}
      {busy && <div className="muted small">{t('ai.reading')}</div>}
      {res && (
        <div className="card flat stack">
          {res.vendor && <b>{res.vendor}</b>}
          {res.items.map((i, k) => <div key={k} className="row between small"><span>{i.qty} × {i.name}</span><span className="num">{formatMoney(i.qty * i.price)}</span></div>)}
          <div className="row between"><b>{t('common.total')}</b><b className="num">{formatMoney(res.total)}</b></div>
          <div className="btn-row">
            <button className="btn give" onClick={() => openSheet(t('cash.newExpense'), <ExpenseSheet prefill={{ amount: res.total, category: res.category, note: res.vendor || res.items.map((i) => i.name).join(', ') }} />)}>{t('ai.useAsExpense')}</button>
            <button className="btn get" onClick={() => openSheet(t('cash.newSale'), <SaleSheet prefill={{ items: res.items.map((i) => ({ name: i.name, qty: i.qty, price: i.price })), amount: res.total }} />)}>{t('ai.useAsSale')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
