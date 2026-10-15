// "Report a problem or complaint": from Help, More, a crash screen, or a customer's invoice / pay page.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOverlay } from '@/ui/overlay';
import { Icon } from '@/ui/Icon';
import { Field } from '@/ui/widgets';
import { waLink } from '@/lib/phone';
import { REPORT_KINDS, sendReport, type ReportKind } from '@/cloud/reports';

const SUPPORT_WHATSAPP = import.meta.env.VITE_SUPPORT_WHATSAPP as string | undefined;
const ICON: Record<ReportKind, string> = { bug: 'alert', money: 'cash', payment: 'wallet', account: 'lock', abuse: 'shield', suggestion: 'spark', other: 'help' };

export function ReportSheet({ kind: k0 = 'bug', about = '', orgId = null, contact: c0 = '', kinds = REPORT_KINDS }: {
  kind?: ReportKind; about?: string; orgId?: string | null; contact?: string; kinds?: ReportKind[];
}) {
  const { t } = useTranslation();
  const { fail } = useOverlay();
  const [f, setF] = useState({ kind: k0, message: '', contact: c0 });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<null | 'sent' | 'queued'>(null);
  const [ref] = useState(() => 'KR-' + Math.random().toString(36).slice(2, 7).toUpperCase());
  const waText = `${t('report.waIntro')} (${ref})\n${t(`report.kind.${f.kind}`)}${about ? ` · ${about}` : ''}\n\n${f.message.trim()}`;

  if (done) return (
    <div className="stack" data-testid="report-done" style={{ textAlign: 'center' }}>
      <div className="report-ok"><Icon name="check" size={34} strokeWidth={2.6} /></div>
      <h2 style={{ justifyContent: 'center' }}>{t('report.thanks')}</h2>
      <div className="muted">{t(done === 'sent' ? 'report.sent' : 'report.queued')}</div>
      <div className="small muted">{t('report.ref', { ref })}</div>
      {SUPPORT_WHATSAPP && <a className="btn ghost block" href={waLink(SUPPORT_WHATSAPP, waText)} target="_blank" rel="noopener noreferrer"><Icon name="chat" size={18} /> {t('report.alsoWa')}</a>}
    </div>
  );

  return (
    <form className="form" data-testid="report-form" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true);
      try { setDone(await sendReport({ kind: f.kind, message: `${f.message.trim()}\n\n(${ref})`, contact: f.contact, about, orgId }, { ref })); } catch (err) { fail(err); } finally { setBusy(false); }
    }}>
      <div className="small muted">{t('report.help')}</div>
      <div className="report-kinds" role="radiogroup" aria-label={t('report.what')}>
        {kinds.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={f.kind === k} className={f.kind === k ? 'on' : ''} onClick={() => setF({ ...f, kind: k })}>
            <Icon name={ICON[k]} size={18} /> {t(`report.kind.${k}`)}
          </button>
        ))}
      </div>
      {about && <div className="small"><b>{t('report.about')}:</b> {about}</div>}
      <Field label={t('report.what')}>
        <textarea name="message" required minLength={5} maxLength={3900} value={f.message} placeholder={t(`report.ph.${f.kind}`)}
          onChange={(e) => setF({ ...f, message: e.target.value })} />
      </Field>
      <Field label={t('report.contact')} hint={t('report.contactHelp')}>
        <input name="contact" inputMode="tel" autoComplete="tel" value={f.contact} maxLength={120} onChange={(e) => setF({ ...f, contact: e.target.value })} />
      </Field>
      <button className="btn primary block" disabled={busy || f.message.trim().length < 5}><Icon name="send" size={18} /> {t('report.send')}</button>
      <div className="small muted">{t('report.privacy')}</div>
    </form>
  );
}

/** Small link for public pages: lets a customer report a business or a payment problem. */
export function ReportBusinessLink({ business }: { business: string }) {
  const { t } = useTranslation();
  const { openSheet } = useOverlay();
  return (
    <button type="button" className="link small" style={{ alignSelf: 'center' }} data-testid="report-business"
      onClick={() => openSheet(t('report.title'), <ReportSheet kind="abuse" about={business} kinds={['abuse', 'payment', 'other']} />)}>
      <Icon name="shield" size={14} /> {t('report.business')}
    </button>
  );
}
