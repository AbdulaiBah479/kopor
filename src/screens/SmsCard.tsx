// Settings → Text messages from your phone: connect the free SMS Gateway app so Kopor can text reminders and answer BAL.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '@/state/app';
import { useOverlay } from '@/ui/overlay';
import { Icon } from '@/ui/Icon';
import { Field } from '@/ui/widgets';
import { getSupabase } from '@/cloud/supabase';
import { smsConnect, smsDisconnect, smsSettings, smsStatus, smsTest, type SmsStatus } from '@/cloud/sms';

export function SmsCard() {
  const { t } = useTranslation();
  const { ctx } = useApp();
  const { toast, fail } = useOverlay();
  const [s, setS] = useState<SmsStatus | null>(null);
  const [f, setF] = useState({ user: '', pass: '', signingKey: '' });
  const [busy, setBusy] = useState(false);
  const load = () => smsStatus(ctx.orgId).then(setS).catch(() => setS(null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { getSupabase().then((sb) => sb && load()); }, [ctx.orgId]);
  if (!s) return null;
  const run = async (fn: () => Promise<unknown>, msg: string) => { setBusy(true); try { await fn(); toast(msg); await load(); } catch (e) { fail(e); } finally { setBusy(false); } };
  const set = (patch: Parameters<typeof smsSettings>[1]) => run(() => smsSettings(ctx.orgId, patch), t('common.saved'));
  return (
    <div className="card stack" data-testid="sms-card">
      <h2><Icon name="sms" size={18} /> {t('sms.title')}</h2>
      <div className="small muted">{t('sms.help')}</div>
      {s.connected ? (
        <>
          <div className="small"><span className="badge good">{t('sms.connected')}</span> {t('sms.sentToday', { n: s.sentToday, limit: s.limit })}</div>
          <label className="check"><input type="checkbox" checked={s.auto} onChange={(e) => set({ auto: e.target.checked })} /> {t('sms.auto')}</label>
          <label className="check"><input type="checkbox" checked={s.bal} onChange={(e) => set({ bal: e.target.checked })} /> {t('sms.bal')}</label>
          {!s.signed && <div className="small warn">{t('sms.needKey')}</div>}
          <Field label={t('sms.limit')}><select value={s.limit} onChange={(e) => set({ limit: Number(e.target.value) })}>{[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>
          <div className="btn-row">
            <button type="button" className="btn" disabled={busy} onClick={() => run(() => smsTest(ctx.orgId), t('sms.tested'))}><Icon name="send" size={18} /> {t('sms.test')}</button>
            <button type="button" className="btn ghost" disabled={busy} onClick={() => confirm(t('common.confirm')) && run(() => smsDisconnect(ctx.orgId), t('sms.disconnected'))}>{t('sms.disconnect')}</button>
          </div>
        </>
      ) : (
        <form className="form" onSubmit={(e) => { e.preventDefault(); run(() => smsConnect(ctx.orgId, f), t('sms.connected')); }}>
          <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
            <li>{t('sms.step1')}</li><li>{t('sms.step2')}</li><li>{t('sms.step3')}</li>
          </ol>
          <Field label={t('sms.user')}><input required autoComplete="off" value={f.user} onChange={(e) => setF({ ...f, user: e.target.value })} /></Field>
          <Field label={t('sms.pass')}><input required type="password" autoComplete="off" value={f.pass} onChange={(e) => setF({ ...f, pass: e.target.value })} /></Field>
          <Field label={t('sms.key')} hint={t('sms.keyHelp')}><input autoComplete="off" value={f.signingKey} onChange={(e) => setF({ ...f, signingKey: e.target.value })} /></Field>
          <button className="btn primary block" disabled={busy}>{t('sms.connect')}</button>
          <div className="small muted">{t('sms.cost')}</div>
        </form>
      )}
    </div>
  );
}
