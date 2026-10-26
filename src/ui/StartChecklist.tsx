import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Book } from '@/domain/book';
import { hasPin } from '@/domain/org';
import { getMeta, setMeta } from '@/db/repo';
import { Icon } from './Icon';

/** Owner's first steps on Home. Ticks itself from the records; goes away when all are done or the owner hides it. */
export function StartChecklist({ book, memberId }: { book: Book; memberId: string }) {
  const { t } = useTranslation();
  const [hidden, setHidden] = useState(true);
  const [pin, setPin] = useState(false);
  const [cloud, setCloud] = useState(false);
  useEffect(() => {
    let live = true;
    getMeta('startDismissed', false).then((d) => { if (live) setHidden(d); });
    hasPin(memberId).then((p) => { if (live) setPin(p); });
    // The cloud code downloads only here, after start-up.
    import('@/cloud/auth').then((m) => m.currentUser()).then((u) => { if (live) setCloud(!!u); }).catch(() => {});
    return () => { live = false; };
  }, [memberId]);

  const steps: [key: string, done: boolean, to: string][] = [
    ['product', book.products.length > 0, '/stock'],
    ['sale', book.txns.some((x) => x.type === 'in'), '/cash'],
    ['credit', book.ledger.length > 0, '/credit'],
    ['pin', pin, '/settings'],
    ['cloud', cloud, '/account'],
    ['staff', book.members.length > 1, '/team'],
    ['close', book.closings.length > 0, '/cash'],
  ];
  const done = steps.filter((s) => s[1]).length;
  if (hidden || done === steps.length) return null;
  return (
    <section className="card stack" data-testid="start-checklist" aria-label={t('prefs.start.title')}>
      <div className="row between">
        <b>{t('prefs.start.title')}</b>
        <span className="small muted">{t('prefs.start.done', { n: done, total: steps.length })}</span>
      </div>
      <div className="list">
        {steps.map(([key, ok, to]) => (
          <Link key={key} to={to} className="item" data-done={ok || undefined}>
            <Icon name={ok ? 'check' : 'chev'} size={18} className={ok ? 'good' : 'muted'} />
            <span className={`flex-1${ok ? ' muted line-through' : ''}`}>{t(`prefs.start.${key}`)}</span>
          </Link>
        ))}
      </div>
      <button className="btn ghost sm" onClick={() => { setHidden(true); void setMeta('startDismissed', true); }}>{t('prefs.start.hide')}</button>
    </section>
  );
}
