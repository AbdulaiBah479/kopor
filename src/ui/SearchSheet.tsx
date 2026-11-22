// Search everything from one box: actions, customers and suppliers, products, invoices, groups, sales and every
// screen of the app (including the ones hidden from More for this kind of business). Matching is done in
// domain/search.ts and only the best few per kind are drawn, so typing stays instant on a big business.
import { useMemo, useState } from 'react';
import { Command } from 'cmdk';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useBook } from '@/state/app';
import { useOverlay } from './overlay';
import { Icon } from './Icon';
import { Avatar } from './widgets';
import { formatMoney } from '@/lib/money';
import { balances } from '@/domain/credit';
import { matcher, searchBook, type Hit, type HitKind, type Screen } from '@/domain/search';

const groupCls = '[&_[cmdk-group-heading]]:px-1 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground';
const itemCls = 'flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-2 py-2 data-[selected=true]:bg-muted';

const ORDER: HitKind[] = ['screen', 'contact', 'product', 'invoice', 'sale', 'group'];
const HEADING: Record<HitKind, string> = { screen: 'searchx.screens', contact: 'ux.customers', product: 'ux.products', invoice: 'ux.invoices', sale: 'searchx.sales', group: 'ux.groups' };
const ICON: Record<HitKind, string> = { screen: 'chev', contact: 'contact', product: 'box', invoice: 'file', sale: 'bag', group: 'users' };

/** Every screen, with words people may type to find it. */
function useScreens(): Screen[] {
  const { t } = useTranslation();
  return useMemo(() => ([
    ['/cash', 'nav.cash', 'cash.newSale'], ['/credit', 'nav.credit', 'credit.remind'], ['/stock', 'nav.stock', 'stock.searchPh'],
    ['/money', 'money.title', 'money.sub'], ['/money?tab=wallet', 'wallet.title', 'wallet.sub'], ['/money?tab=setup', 'pay.title', 'pay.sub'],
    ['/invoices', 'inv.title', 'more.invoicesSub'], ['/reminders', 'settings.reminders', 'more.remindersSub'], ['/messages', 'msg.title', 'msg.menuSub'],
    ['/layaway', 'lay.title', 'lay.menuSub'], ['/agent', 'agent.title', 'agent.menuSub'], ['/groups', 'groups.title', 'morex.fs.groups'],
    ['/savings', 'save.title', 'save.menuSub'], ['/bills', 'bills.title', 'bills.menuSub'], ['/staff', 'staff.title', 'staff.menuSub'],
    ['/team', 'team.title', 'morex.fs.team'], ['/health', 'healthx.title', 'health.sub'], ['/health?tab=passport', 'pass.title', 'pass.menuSub'],
    ['/pnl', 'pnl.title', 'pnl.sub'], ['/gst', 'gst.title', 'gst.menuSub'], ['/watch', 'watch.title', 'watch.menuSub'],
    ['/assistant', 'more.assistant', 'more.assistantSub'], ['/account', 'settings.cloud', 'settings.syncOff'], ['/plan', 'plan.title', 'plan.freeSub'],
    ['/settings', 'settings.title', 'more.settingsSub'], ['/help', 'help.title', 'help.sub'],
  ] as const).map(([to, title, sub]) => ({ to, title: t(title, { count: 0, score: '' }), sub: t(sub, { count: 0, score: '' }) })), [t]);
}

export function SearchSheet({ actions }: { actions: { label: string; icon: string; run: () => void }[] }) {
  const { t } = useTranslation();
  const book = useBook();
  const nav = useNavigate();
  const { closeSheet } = useOverlay();
  const screens = useScreens();
  const [q, setQ] = useState('');
  const bal = useMemo(() => balances(book.ledger), [book.ledger]);
  const hits = useMemo(() => searchBook(book, q, screens), [book, q, screens]);
  const m = matcher(q);
  const shownActions = q.trim() ? actions.filter((a) => m(a.label)) : actions;
  const go = (path: string) => { closeSheet(); nav(path); };
  const row = (h: Hit) => (
    <Command.Item key={`${h.kind}-${h.id}`} value={`${h.kind}-${h.id}`} onSelect={() => go(h.to)} className={itemCls}>
      {h.kind === 'contact' ? <Avatar name={h.title} size={36} /> : <span className="grid size-9 place-items-center rounded-xl bg-muted"><Icon name={ICON[h.kind]} size={18} /></span>}
      <span className="min-w-0 flex-1"><span className="block truncate">{h.title || t('searchx.sale')}</span>{h.sub && <span className="block truncate text-sm text-muted-foreground">{h.sub}</span>}</span>
      {h.kind === 'contact' ? (() => { const b = bal.get(h.id) ?? 0; return <span className={`num text-sm font-bold ${b > 0 ? 'text-primary' : b < 0 ? 'text-danger' : 'text-muted-foreground'}`}>{formatMoney(Math.abs(b))}</span>; })()
        : h.amount !== undefined && <span className="num text-sm">{formatMoney(h.amount)}</span>}
    </Command.Item>
  );
  return (
    <Command label={t('ux.searchTitle')} shouldFilter={false} className="flex flex-col gap-2">
      <div className="search">
        <Icon name="search" size={18} />
        <Command.Input autoFocus value={q} onValueChange={setQ} placeholder={t('searchx.placeholder')} className="w-full" data-testid="search-input" />
      </div>
      <Command.List className="max-h-[60dvh] overflow-y-auto">
        {q.trim() && !hits.length && !shownActions.length && <div className="py-8 text-center text-muted-foreground">{t('ux.noResults')}</div>}
        {shownActions.length > 0 && (
          <Command.Group heading={t('ux.actions')} className={groupCls}>
            {shownActions.map((a) => (
              <Command.Item key={a.label} value={`action ${a.label}`} onSelect={() => a.run()} className={itemCls}>
                <span className="grid size-9 place-items-center rounded-xl bg-primary-soft text-primary"><Icon name={a.icon} size={18} /></span>{a.label}
              </Command.Item>
            ))}
          </Command.Group>
        )}
        {ORDER.map((k) => {
          const list = hits.filter((h) => h.kind === k);
          return list.length ? <Command.Group key={k} heading={t(HEADING[k])} className={groupCls}>{list.map(row)}</Command.Group> : null;
        })}
        {!q.trim() && <div className="px-1 py-3 text-sm text-muted-foreground">{t('searchx.hint')}</div>}
      </Command.List>
    </Command>
  );
}
