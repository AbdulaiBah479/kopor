import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useBook } from '@/state/app';
import { useErrorText } from '@/ui/overlay';
import { Page } from '@/ui/Shell';
import { Icon } from '@/ui/Icon';
import { askAssistant, aiAvailable } from '@/ai/assistant';
import { formatMoney } from '@/lib/money';
import { insights } from '@/domain/insights';
import { answerOffline } from '@/ai/offline';

type Msg = { role: 'user' | 'assistant'; content: string };

export function Assistant() {
  const { t, i18n } = useTranslation();
  const book = useBook();
  const errText = useErrorText();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<boolean | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { aiAvailable().then(setOk); }, []);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, busy]);

  const ask = async (question: string) => {
    if (!question.trim() || busy) return;
    const history = [...msgs, { role: 'user' as const, content: question }];
    setMsgs(history); setQ(''); setBusy(true);
    // Without AI (offline, no key, provider busy or daily limit reached) answer from the records instead.
    const offlineAnswer = () => `${answerOffline(question, book, t)}\n\n— ${t('off.mode')}`;
    try {
      const answer = ok && navigator.onLine ? (await askAssistant(question, msgs, book, i18n.language)).trim() : offlineAnswer();
      setMsgs([...history, { role: 'assistant', content: answer || offlineAnswer() }]);
    } catch (e) {
      console.warn('AI unavailable, answering offline:', errText(e));
      setMsgs([...history, { role: 'assistant', content: offlineAnswer() }]);
    }
    finally { setBusy(false); }
  };

  // Offline fallback: show the rule-based insights as the advisor's opening message.
  const offline = insights(book).map((i) => '• ' + t(i.key, Object.fromEntries(Object.entries(i.params).map(([k, v]) => [k, k === 'amount' && typeof v === 'number' ? formatMoney(v) : k === 'cat' ? t(`categories.${v}`) : v])))).join('\n');

  return (
    <Page guide="assistant" title={t('ai.askTitle')} sub={t('ai.askHelp')} back="/more"
      after={ok !== null && (
        <footer className="chat-input"><form onSubmit={(e) => { e.preventDefault(); ask(q); }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ai.askPh')} aria-label={t('ai.askPh')} />
          <button className="btn primary" disabled={busy} aria-label={t('ai.understand')}><Icon name="send" size={18} /></button>
        </form></footer>
      )}>
      <div className="chat">
        {offline && <div className="bubble ai">{offline}</div>}
        {ok === false && <div className="alert small"><Icon name="offline" /><div>{t('off.help')} <Link to="/settings">{t('settings.title')}</Link></div></div>}
        {ok !== null && msgs.length === 0 && (
          <div className="chips">{(['q1', 'q2', 'q3', 'q4'] as const).map((k) => <button key={k} className="chip" onClick={() => ask(t(`ai.${k}`))}>{t(`ai.${k}`)}</button>)}</div>
        )}
        {msgs.map((m, i) => <div key={i} className={`bubble ${m.role === 'user' ? 'me' : 'ai'}`}>{m.content}</div>)}
        {busy && <div className="bubble ai muted">{t('ai.thinking')}</div>}
        <div ref={end} style={{ height: 70 }} />
      </div>
    </Page>
  );
}
