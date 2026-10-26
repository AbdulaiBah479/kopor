import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from './Icon';
import { formatMoney, formatShort, parseMoney, toMajor, currencySymbol } from '@/lib/money';
import { fmtDate, weekdayShort } from '@/lib/dates';
import { dateLocale } from '@/i18n';
import { evaluate, hasOperator } from '@/lib/calc';
import { haptic } from './overlay';
import type { LineItem, Product } from '@/db/schema';

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted small">{hint}</small>}
    </label>
  );
}

export function Empty({ icon, title, text }: { icon: string; title: string; text?: string }) {
  return <div className="empty"><Icon name={icon} size={32} /><b>{title}</b>{text}</div>;
}

/** Amount. compact (for narrow tiles) drops the cents and shortens very large amounts; the exact value stays in the label. */
export const Money = ({ v, className = '', sign, compact }: { v: number; className?: string; sign?: boolean; compact?: boolean }) => {
  const full = formatMoney(v, { sign });
  if (!compact) return <span className={`num money ${className}`}>{full}</span>;
  const short = Math.abs(v) >= 100_000_00 ? `${currencySymbol()} ${formatShort(v)}` : formatMoney(Math.round(v / 100) * 100, { sign });
  // Long amounts get a slightly smaller size so narrow tiles show them in full instead of cutting them off.
  return <span className={`num money nowrap${short.length > 8 ? ' tight' : ''} ${className}`} title={full} aria-label={full}>{short}</span>;
};

export function useDate() {
  const { i18n } = useTranslation();
  const loc = dateLocale(i18n.language);
  return { fmt: (d: string | null | undefined) => fmtDate(d, loc), loc };
}

export function Search({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="search">
      <Icon name="search" size={18} />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="tablist">
      {options.map(([k, l]) => (
        <button key={k} type="button" role="tab" aria-selected={k === value} className={k === value ? 'on' : ''} onClick={() => onChange(k)}>{l}</button>
      ))}
    </div>
  );
}

/**
 * Money input that keeps the user's text and reports minor units.
 * The big variant is the main amount of a form: it shows a calculator keypad (no phone keyboard popping up)
 * and accepts sums like "300+250".
 */
export function MoneyInput({ name, value, onChange, big, autoFocus, required }: { name?: string; value: number; onChange: (v: number) => void; big?: boolean; autoFocus?: boolean; required?: boolean }) {
  const { t } = useTranslation();
  const [text, setText] = useState(value ? String(toMajor(value)) : '');
  const update = (s: string) => {
    setText(s);
    const v = hasOperator(s) ? evaluate(s) : null;
    onChange(v !== null ? parseMoney(v) : parseMoney(s));
  };
  if (!big) return <input name={name} inputMode="decimal" placeholder="0" autoFocus={autoFocus} required={required} value={text} onChange={(e) => update(e.target.value)} />;
  const result = hasOperator(text) ? evaluate(text) : null;
  const press = (k: string) => {
    haptic(8);
    if (k === 'back') update(text.slice(0, -1));
    else update(text + k);
  };
  // The sum is worked out live and saved automatically, so there is no "=" key.
  const keys = ['7', '8', '9', 'back', '4', '5', '6', '+', '1', '2', '3', '-', '00', '0', '.', '×'];
  return (
    <div className="flex flex-col gap-2">
      <input name={name} inputMode="none" className="amount-input" placeholder="0" autoFocus={autoFocus} required={required} autoComplete="off"
        value={text} onChange={(e) => update(e.target.value)} aria-describedby={name ? `${name}-result` : undefined} />
      <div id={name ? `${name}-result` : undefined} className="min-h-5 text-center text-sm font-semibold text-muted-foreground num" aria-live="polite">
        {result !== null ? t('ux.equals', { amount: formatMoney(parseMoney(result)) }) : ''}
      </div>
      <div className="grid grid-cols-4 gap-2" role="group" aria-label={t('ux.keypad')}>
        {keys.map((k) => (
          <button key={k} type="button" onClick={() => press(k)} aria-label={k === 'back' ? t('common.back') : k}
            className={`h-[52px] rounded-xl text-[26px] font-normal transition active:scale-95 active:brightness-90 ${/^[-+×]$/.test(k) ? 'bg-primary-soft text-primary font-medium' : k === 'back' ? 'bg-fill text-foreground' : 'bg-card text-foreground'}`}>
            {k === 'back' ? <Icon name="backspace" className="mx-auto" /> : k === '-' ? '−' : k}
          </button>
        ))}
      </div>
    </div>
  );
}

// iOS system colours; the circle is a translucent tint of the same colour, so it suits light and dark mode.
const AVATAR_TONES = ['--tile-green', '--tile-blue', '--tile-orange', '--tile-purple', '--tile-red', '--tile-teal', '--tile-indigo', '--tile-pink'];
/** Initials on a colour chosen from the name, so each customer is recognisable at a glance. */
export function Avatar({ name, size = 42 }: { name: string; size?: number }) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const tone = `var(${AVATAR_TONES[h % AVATAR_TONES.length]})`;
  return <div className="avatar" style={{ width: size, height: size, background: `color-mix(in srgb, ${tone} 18%, transparent)`, color: `color-mix(in srgb, ${tone} 55%, var(--foreground))` }} aria-hidden="true">{initials(name)}</div>;
}

type ContactsApi = { select: (props: string[], opts: { multiple: boolean }) => Promise<{ name?: string[]; tel?: string[] }[]> };
const contactsApi = () => (navigator as unknown as { contacts?: ContactsApi }).contacts;
/** Pick a customer from the phone's contacts (Chrome on Android). Hidden where unsupported. */
export function ContactPick({ onPick }: { onPick: (c: { name: string; phone: string }) => void }) {
  const { t } = useTranslation();
  if (!contactsApi()) return null;
  return (
    <button type="button" className="btn sm ghost" onClick={async () => {
      try {
        const [c] = await contactsApi()!.select(['name', 'tel'], { multiple: false });
        if (c) onPick({ name: c.name?.[0] ?? '', phone: c.tel?.[0] ?? '' });
      } catch { /* user cancelled */ }
    }}><Icon name="contact" size={16} /> {t('ux.fromContacts')}</button>
  );
}

/** Editable list of line items with product autocomplete (price fills in from stock). */
export function ItemsEditor({ items, onChange, products, subtotal }: { items: Partial<LineItem>[]; onChange: (i: Partial<LineItem>[]) => void; products: Product[]; subtotal?: boolean }) {
  const { t } = useTranslation();
  const rows = items.length ? items : [{ qty: 1 }];
  const set = (k: number, patch: Partial<LineItem>) => onChange(rows.map((r, i) => (i === k ? { ...r, ...patch } : r)));
  const total = rows.reduce((s, r) => s + (r.qty ?? 0) * (r.price ?? 0), 0);
  return (
    <div className="items-editor">
      {rows.map((r, k) => (
        <div className="item-row" key={k}>
          <input list="dl-products" placeholder={t('common.item')} aria-label={t('common.item')} value={r.name ?? ''} autoComplete="off" name="item_name"
            onChange={(e) => {
              const p = products.find((x) => x.name.toLowerCase() === e.target.value.trim().toLowerCase());
              set(k, p ? { name: e.target.value, product_id: p.id, price: p.price, per: undefined } : { name: e.target.value, product_id: null, per: undefined });
            }} />
          <input inputMode="decimal" placeholder={t('common.qty')} aria-label={t('common.qty')} value={r.qty ?? ''} name="item_qty"
            onChange={(e) => set(k, { qty: Number(e.target.value) || 0 })} />
          <input inputMode="decimal" placeholder={t('common.price')} aria-label={t('common.price')} name="item_price"
            value={r.price !== undefined ? toMajor(r.price) : ''} onChange={(e) => set(k, { price: parseMoney(e.target.value) })} />
          <button type="button" className="icon-btn" aria-label={t('common.delete')}
            onClick={() => onChange(rows.length > 1 ? rows.filter((_, i) => i !== k) : [{ qty: 1 }])}><Icon name="x" size={18} /></button>
          {(() => {
            // Products sold by the carton too: switch this line between pieces and cartons (price follows).
            const p = r.product_id ? products.find((x) => x.id === r.product_id) : undefined;
            if (!p?.pack_size) return null;
            const carton = (r.per ?? 1) > 1;
            return (
              <div className="seg" style={{ gridColumn: '1 / -1' }} data-testid="pack-toggle">
                <button type="button" className={carton ? '' : 'on'} onClick={() => set(k, { per: undefined, price: p.price })}>{p.unit}</button>
                <button type="button" className={carton ? 'on' : ''} onClick={() => set(k, { per: p.pack_size!, price: p.pack_price ?? p.price * p.pack_size! })}>
                  {t('pack.of', { name: p.pack_name || t('pack.carton'), n: p.pack_size, unit: p.unit })}</button>
              </div>
            );
          })()}
        </div>
      ))}
      <button type="button" className="btn sm ghost" onClick={() => onChange([...rows, { qty: 1 }])}><Icon name="plus" size={16} /> {t('common.addItem')}</button>
      <div className="total-line"><span>{t(subtotal ? 'tax.subtotal' : 'common.total')}</span><Money v={Math.round(total)} /></div>
      <datalist id="dl-products">{products.map((p) => <option key={p.id} value={p.name} />)}</datalist>
    </div>
  );
}

/** Grouped bars of sales vs expenses per day. Tap or hover a day for exact values. */
export function BarChart({ series }: { series: { date: string; sales: number; expenses: number }[] }) {
  const { t } = useTranslation();
  const { fmt, loc } = useDate();
  const [tip, setTip] = useState<number | null>(null);
  const W = 340, H = 150, padL = 34, padB = 20, padT = 8;
  const max = Math.max(100, ...series.flatMap((d) => [d.sales, d.expenses]));
  const step = niceStep(max / 3);
  const top = Math.ceil(max / step) * step;
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / top);
  const slot = (W - padL) / series.length;
  const bw = Math.min(14, slot / 3);
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
  const sel = tip !== null ? series[tip] : null;
  return (
    <div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${t('cash.sales')} / ${t('cash.expenses')}`}>
        {ticks.map((v) => (
          <g key={v}><line className="grid" x1={padL} x2={W} y1={y(v)} y2={y(v)} />
            <text className="axis" x={padL - 6} y={y(v) + 4} textAnchor="end">{formatShort(v)}</text></g>
        ))}
        {series.map((d, i) => {
          const cx = padL + slot * i + slot / 2;
          return (
            <g key={d.date}>
              {d.sales > 0 && <path className="bar-in" d={roundTop(cx - bw - 1, y(d.sales), bw, y(0) - y(d.sales))} />}
              {d.expenses > 0 && <path className="bar-out" d={roundTop(cx + 1, y(d.expenses), bw, y(0) - y(d.expenses))} />}
              <text className="axis" x={cx} y={H - 4} textAnchor="middle">{weekdayShort(d.date, loc)}</text>
              <rect className="hit" x={padL + slot * i} y={padT} width={slot} height={H - padT - padB} rx={6}
                onPointerEnter={() => setTip(i)} onPointerDown={() => setTip(i)} onPointerLeave={() => setTip(null)} />
            </g>
          );
        })}
      </svg>
      <div className="legend">
        <span><i style={{ background: 'var(--series-in)' }} />{t('cash.sales')}</span>
        <span><i style={{ background: 'var(--series-out)' }} />{t('cash.expenses')}</span>
        {sel && <span className="num" style={{ marginLeft: 'auto' }}><b>{fmt(sel.date)}</b> · {formatMoney(sel.sales)} / {formatMoney(sel.expenses)}</span>}
      </div>
    </div>
  );
}
function niceStep(x: number) {
  const p = Math.pow(10, Math.floor(Math.log10(x || 1)));
  const n = x / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
function roundTop(x: number, yTop: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${yTop + h}V${yTop + r}Q${x},${yTop} ${x + r},${yTop}H${x + w - r}Q${x + w},${yTop} ${x + w},${yTop + r}V${yTop + h}Z`;
}

export function ScoreRing({ score, size = 84 }: { score: number; size?: number }) {
  const r = size / 2 - 7, c = 2 * Math.PI * r;
  const color = score >= 60 ? 'var(--good)' : score >= 40 ? 'var(--warn)' : 'var(--bad)';
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} aria-hidden="true">
        <circle className="track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={8} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={8} strokeLinecap="round" strokeDasharray={`${(c * score) / 100} ${c}`} />
      </svg>
      <b className="num">{score}</b>
    </div>
  );
}

export const initials = (name: string) => {
  const p = (name || '?').trim().split(/\s+/);
  return ((p[0]?.[0] ?? '?') + (p[1]?.[0] ?? '')).toUpperCase();
};

/** "Confirmed by Monime": real money that Monime confirmed (only the server can set this, so it cannot be faked). */
export function Verified({ id: r }: { id?: string | null }) {
  const { t } = useTranslation();
  if (!r) return null;
  return <span className="badge good verified" title={t('verified.long')} aria-label={t('verified.long')} data-testid="verified">✓ {t('verified.short')}</span>;
}
