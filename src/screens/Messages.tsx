// Messages to customers: tell them about new stock, an offer or opening hours, and bring back the ones who stopped
// coming. Sent from the shop's own phone by SMS when it is connected, or on WhatsApp one by one ("Send next"), since
// WhatsApp cannot be sent automatically for free.
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp, useBook } from '@/state/app';
import { useOverlay } from '@/ui/overlay';
import { Page } from '@/ui/Shell';
import { Icon } from '@/ui/Icon';
import { Field, Seg } from '@/ui/widgets';
import { waLink } from '@/lib/phone';
import { AUDIENCES, audienceOf, personal, type Audience } from '@/domain/audience';

const TEMPLATES = ['newStock', 'offer', 'open', 'missYou', 'thanks'] as const;

export function Messages() {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx } = useApp();
  const { toast, fail } = useOverlay();
  const [aud, setAud] = useState<Audience>('all');
  const [text, setText] = useState('');
  const [sms, setSms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<Set<string>>(new Set());
  useEffect(() => { import('@/cloud/sms').then((m) => m.smsStatus(ctx.orgId)).then((s) => setSms(s.connected)).catch(() => {}); }, [ctx.orgId]);
  const people = useMemo(() => audienceOf(book, aud), [book, aud]);
  const counts = useMemo(() => Object.fromEntries(AUDIENCES.map((a) => [a, audienceOf(book, a).length])), [book]);
  const ok = text.trim().length >= 5;
  const next = people.find((c) => !sent.has(c.id));
  const cc = book.org.country_code;

  return (
    <Page title={t('msg.title')} sub={t('msg.sub')} back="/more">
      <div className="card flat small">{t('msg.intro')}</div>
      <Field label={t('msg.to')}>
        <Seg value={aud} onChange={(a) => { setAud(a); setSent(new Set()); }} options={AUDIENCES.map((a) => [a, `${t(`msg.aud.${a}`)} (${counts[a]})`])} />
      </Field>
      <div className="small muted">{t(`msg.audHelp.${aud}`)}</div>
      <div className="chips">
        {TEMPLATES.map((k) => <button type="button" key={k} className="chip" onClick={() => setText(t(`msg.tpl.${k}`, { shop: book.org.name }))}>{t(`msg.tplName.${k}`)}</button>)}
      </div>
      <Field label={t('msg.text')} hint={t('msg.textHelp')}>
        <textarea name="message" maxLength={300} rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('msg.textPh')} />
      </Field>
      {ok && people[0] && <div className="card flat small" data-testid="msg-preview"><b>{t('msg.preview')}:</b> {personal(text, people[0])}</div>}
      {!people.length && <div className="small muted">{t('msg.nobody')}</div>}
      {sms && (
        <button type="button" className="btn primary block" data-testid="msg-sms" disabled={!ok || !people.length || busy} onClick={async () => {
          if (!confirm(t('msg.confirm', { n: people.length }))) return;
          setBusy(true);
          try {
            const { smsBroadcast } = await import('@/cloud/sms');
            const r = await smsBroadcast(ctx.orgId, people.map((c) => c.id), text.trim());
            toast(t('msg.smsDone', { sent: r.sent, left: r.notSent }));
          } catch (e) { fail(e); } finally { setBusy(false); }
        }}><Icon name="sms" size={18} /> {t('msg.sendSms', { n: people.length })}</button>
      )}
      <button type="button" className="btn get block" data-testid="msg-wa" disabled={!ok || !next} onClick={() => {
        if (!next) return;
        window.open(waLink(next.phone, personal(text, next), cc), '_blank', 'noopener');
        setSent(new Set(sent).add(next.id));
      }}><Icon name="chat" size={18} /> {next ? t('msg.waNext', { name: next.name, done: sent.size, n: people.length }) : t('msg.waDone')}</button>
      <div className="small muted">{t('msg.respect')}</div>
    </Page>
  );
}
