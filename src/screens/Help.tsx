import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Page } from '@/ui/Shell';
import { Icon } from '@/ui/Icon';
import { setMeta } from '@/db/repo';
import { waLink } from '@/lib/phone';
import { useOverlay } from '@/ui/overlay';
import { ReportSheet } from './Report';

const SUPPORT_WHATSAPP = import.meta.env.VITE_SUPPORT_WHATSAPP as string | undefined;
const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL as string | undefined;
const QUESTIONS = ['start', 'credit', 'offline', 'backup', 'staff', 'payments', 'ai', 'printer', 'tax', 'pro'] as const;

export function Help() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { openSheet } = useOverlay();
  return (
    <Page title={t('help.title')} sub={t('help.sub')} back="/more">
      <button className="btn tinted block" data-testid="report-btn" onClick={() => openSheet(t('report.title'), <ReportSheet />)}><Icon name="alert" size={18} /> {t('report.title')}</button>
      <button className="btn primary block" onClick={async () => { await setMeta('tourDone', false); nav('/'); }}><Icon name="spark" size={18} /> {t('help.tour')}</button>
      <div className="list">
        {QUESTIONS.map((k) => (
          <details key={k} className="item" style={{ display: 'block' }}>
            <summary style={{ fontWeight: 650, cursor: 'pointer' }}>{t(`help.q.${k}`)}</summary>
            <p className="small" style={{ margin: '8px 0 0', color: 'var(--ink-2)' }}>{t(`help.a.${k}`)}</p>
          </details>
        ))}
      </div>
      {SUPPORT_WHATSAPP && <a className="btn get block" href={waLink(SUPPORT_WHATSAPP, 'Hello Kopor support,')} target="_blank" rel="noopener noreferrer"><Icon name="chat" size={18} /> {t('help.contact')}</a>}
      {SUPPORT_EMAIL && <a className="btn ghost block" href={`mailto:${SUPPORT_EMAIL}?subject=Kopor`}><Icon name="send" size={18} /> {SUPPORT_EMAIL}</a>}
      <div className="btn-row">
        <Link className="btn ghost" to="/legal/privacy">{t('legal.privacy')}</Link>
        <Link className="btn ghost" to="/legal/terms">{t('legal.terms')}</Link>
      </div>
    </Page>
  );
}
