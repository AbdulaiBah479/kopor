// Home card on the Android test app when a newer build is published: what's new, Update (downloads the APK, which
// installs over this one and keeps every record), or Later.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { APK_URL, checkForUpdate, skipUpdate, type Update } from '@/features/appUpdate';
import { Icon } from './Icon';

export function UpdateCard() {
  const { t } = useTranslation();
  const [u, setU] = useState<Update | null>(null);
  useEffect(() => { let live = true; checkForUpdate().then((x) => live && setU(x)).catch(() => {}); return () => { live = false; }; }, []);
  if (!u) return null;
  return (
    <div className="card stack" data-testid="update-card" role="status">
      <div className="row between"><b><Icon name="spark" size={18} /> {t('upd.title')}</b><span className="small muted">{t('upd.build', { n: u.build })}</span></div>
      {u.notes.length > 0 && (
        <>
          <div className="small muted">{t('upd.whatsNew')}</div>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{u.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </>
      )}
      <div className="small muted">{t('upd.help')}</div>
      <div className="btn-row">
        <a className="btn primary" href={APK_URL} target="_blank" rel="noopener noreferrer"><Icon name="download" size={18} /> {t('upd.update')}</a>
        <button type="button" className="btn ghost" onClick={() => { skipUpdate(u.build); setU(null); }}>{t('upd.later')}</button>
      </div>
    </div>
  );
}
