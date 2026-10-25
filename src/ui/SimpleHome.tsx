// Picture and voice mode: big pictures instead of words, and everything can be read aloud. For owners who do not read
// easily. Each picture says what it is when tapped (if voice is on), then opens the same simple form as the full app.
import { Suspense, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { lazyRetry } from './lazy';
import { useApp, useBook } from '@/state/app';
import { useOverlay } from './overlay';
import { Icon } from './Icon';
import { formatMoney } from '@/lib/money';
import { today } from '@/lib/dates';
import { sayMoney, speak, stopSpeaking } from '@/lib/speak';
import { summary } from '@/domain/cash';
import { creditTotals } from '@/domain/credit';
import { SaleSheet, ExpenseSheet } from '@/screens/Cash';
import { NewCreditSheet } from '@/screens/Credit';

const VoiceSheet = lazyRetry(() => import('@/screens/AiSheets').then((m) => ({ default: m.VoiceSheet })));

export function SimpleHome() {
  const { t, i18n } = useTranslation();
  const book = useBook();
  const { can, device, setDevice } = useApp();
  const { openSheet } = useOverlay();
  const nav = useNavigate();
  useEffect(() => stopSpeaking, []);           // leaving Home stops any reading
  const d = today(), s = summary(book, d, d), owed = creditTotals(book).get;
  const say = (text: string) => device.voice && speak(text, i18n.language);
  const tiles: { key: string; icon: string; tone: string; run: () => void; show?: boolean }[] = [
    { key: 'sold', icon: 'cash', tone: 'var(--good, #047857)', run: () => openSheet(t('cash.newSale'), <SaleSheet />) },
    { key: 'speak', icon: 'mic', tone: 'var(--tile-indigo, #4f46e5)', run: () => openSheet(t('ai.speakTitle'), <Suspense fallback={t('common.loading')}><VoiceSheet /></Suspense>) },
    { key: 'spent', icon: 'minus', tone: 'var(--bad, #b42318)', run: () => openSheet(t('cash.newExpense'), <ExpenseSheet />) },
    { key: 'credit', icon: 'book', tone: 'var(--tile-orange, #ea580c)', run: () => openSheet(t('credit.addEntry'), <NewCreditSheet type="gave" />) },
    { key: 'paid', icon: 'coins', tone: 'var(--tile-teal, #0d9488)', run: () => openSheet(t('credit.addEntry'), <NewCreditSheet type="got" />) },
    { key: 'stock', icon: 'box', tone: 'var(--tile-blue, #2563eb)', run: () => nav('/stock'), show: can('record') },
  ];
  const daySummary = () => speak(t('simple.say', { sales: sayMoney(formatMoney(s.sales)), owed: sayMoney(formatMoney(owed)) }), i18n.language);
  return (
    <div className="stack" data-testid="simple-home">
      <button type="button" className="hero balance-card" style={{ border: 0, textAlign: 'left', font: 'inherit', cursor: 'pointer', width: '100%' }} onClick={daySummary} data-testid="simple-say">
        <div className="balance-head">
          <span className="label"><Icon name="mic" size={14} /> {t('simple.todaySold')}</span>
          <span className="amount">{formatMoney(s.sales)}</span>
          <span className="split"><span>{t('simple.owed')} <b>{formatMoney(owed)}</b></span></span>
        </div>
        <div className="small" style={{ opacity: 0.85 }}>{t('simple.tapToHear')}</div>
      </button>
      <div className="simple-grid">
        {tiles.filter((x) => x.show !== false && can('record')).map((x) => (
          <button key={x.key} type="button" className="simple-tile" data-testid={`simple-${x.key}`}
            onClick={() => { say(t(`simple.t.${x.key}`)); x.run(); }} aria-label={t(`simple.t.${x.key}`)}>
            <span className="simple-icon" style={{ background: x.tone }}><Icon name={x.icon} size={40} /></span>
            <span className="simple-label">{t(`simple.t.${x.key}`)}</span>
          </button>
        ))}
      </div>
      <div className="btn-row">
        <button type="button" className="btn" aria-pressed={device.voice} onClick={() => setDevice({ voice: !device.voice })}>
          <Icon name="mic" size={18} /> {device.voice ? t('simple.voiceOn') : t('simple.voiceOff')}</button>
        <button type="button" className="btn ghost" data-testid="simple-exit" onClick={() => setDevice({ simple: false })}>{t('simple.full')}</button>
      </div>
    </div>
  );
}
