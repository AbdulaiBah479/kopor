// Search everything from one box (cmdk: fast fuzzy matching, full keyboard support).
import { Command } from 'cmdk';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useBook } from '@/state/app';
import { useOverlay } from './overlay';
import { Icon } from './Icon';
import { Avatar } from './widgets';
import { formatMoney } from '@/lib/money';
import { balances } from '@/domain/credit';
import { invoiceTotal } from '@/domain/invoices';

const groupCls = '[&_[cmdk-group-heading]]:px-1 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground';
const itemCls = 'flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-2 py-2 data-[selected=true]:bg-muted';

export function SearchSheet({ actions }: { actions: { label: string; icon: string; run: () => void }[] }) {
  const { t } = useTranslation();
  const book = useBook();
  const nav = useNavigate();
  const { closeSheet } = useOverlay();
  const bal = balances(book.ledger);
  const go = (path: string) => { closeSheet(); nav(path); };
  return (
    <Command label={t('ux.searchTitle')} className="flex flex-col gap-2">
      <div className="search">
        <Icon name="search" size={18} />
        <Command.Input autoFocus placeholder={t('ux.search')} className="w-full" />
      </div>
      <Command.List className="max-h-[60dvh] overflow-y-auto">
        <Command.Empty className="py-8 text-center text-muted-foreground">{t('ux.noResults')}</Command.Empty>
        <Command.Group heading={t('ux.actions')} className={groupCls}>
          {actions.map((a) => (
            <Command.Item key={a.label} value={`action ${a.label}`} onSelect={() => a.run()} className={itemCls}>
              <span className="grid size-9 place-items-center rounded-xl bg-primary-soft text-primary"><Icon name={a.icon} size={18} /></span>{a.label}
            </Command.Item>
          ))}
        </Command.Group>
        <Command.Group heading={t('ux.customers')} className={groupCls}>
          {book.contacts.map((c) => {
            const b = bal.get(c.id) ?? 0;
            return (
              <Command.Item key={c.id} value={`${c.name} ${c.phone}`} onSelect={() => go(`/credit/${c.id}`)} className={itemCls}>
                <Avatar name={c.name} size={36} /><span className="flex-1 truncate">{c.name}</span>
                <span className={`num text-sm font-bold ${b > 0 ? 'text-primary' : b < 0 ? 'text-danger' : 'text-muted-foreground'}`}>{formatMoney(Math.abs(b))}</span>
              </Command.Item>
            );
          })}
        </Command.Group>
        <Command.Group heading={t('ux.products')} className={groupCls}>
          {book.products.map((p) => (
            <Command.Item key={p.id} value={`${p.name} ${p.sku}`} onSelect={() => go('/stock')} className={itemCls}>
              <span className="grid size-9 place-items-center rounded-xl bg-muted"><Icon name="box" size={18} /></span>
              <span className="flex-1 truncate">{p.name}</span><span className="num text-sm text-muted-foreground">{formatMoney(p.price)}</span>
            </Command.Item>
          ))}
        </Command.Group>
        <Command.Group heading={t('ux.invoices')} className={groupCls}>
          {book.invoices.map((i) => (
            <Command.Item key={i.id} value={`${i.number} ${i.customer}`} onSelect={() => go(`/invoices/${i.id}`)} className={itemCls}>
              <span className="grid size-9 place-items-center rounded-xl bg-muted"><Icon name="file" size={18} /></span>
              <span className="flex-1 truncate">{i.number} · {i.customer}</span><span className="num text-sm">{formatMoney(invoiceTotal(i))}</span>
            </Command.Item>
          ))}
        </Command.Group>
        <Command.Group heading={t('ux.groups')} className={groupCls}>
          {book.groups.map((g) => (
            <Command.Item key={g.id} value={g.name} onSelect={() => go(`/groups/${g.id}`)} className={itemCls}>
              <span className="grid size-9 place-items-center rounded-xl bg-muted"><Icon name="users" size={18} /></span><span className="flex-1 truncate">{g.name}</span>
            </Command.Item>
          ))}
        </Command.Group>
      </Command.List>
    </Command>
  );
}
