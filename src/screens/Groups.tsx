import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useApp, useBook } from '@/state/app';
import { useOverlay } from '@/ui/overlay';
import { Page } from '@/ui/Shell';
import { Icon } from '@/ui/Icon';
import { Empty, Field, MoneyInput, initials, useDate } from '@/ui/widgets';
import { formatMoney } from '@/lib/money';
import { today } from '@/lib/dates';
import { waLink } from '@/lib/phone';
import { update, remove, atomic } from '@/db/repo';
import type { Group } from '@/db/schema';
import { currentRound, totalRounds, roundDate, roundStatus, collectorFor, groupTotal, memberReliability, parseMembers, saveGroup, toggleContribution, markPayout } from '@/domain/groups';
import { createPayout, momoProviders } from '@/cloud/payments';
import { DeleteButton } from './Credit';

export function GroupList() {
  const { t } = useTranslation();
  const book = useBook();
  const { can } = useApp();
  const { openSheet } = useOverlay();
  return (
    <Page guide="groups" title={t('groups.title')} sub={t('groups.sub')} back="/more"
      fab={can('groups') && <button className="fab" onClick={() => openSheet(t('groups.new'), <GroupSheet />)}><Icon name="plus" /> {t('groups.new')}</button>}>
      <div className="card flat small">{t('groups.intro')}</div>
      <div className="list">
        {book.groups.length ? book.groups.map((g) => {
          const r = currentRound(g);
          const s = roundStatus(book, g, r);
          const pct = s.expected ? Math.round((s.collected / s.expected) * 100) : 0;
          return (
            <Link key={g.id} className="item" to={`/groups/${g.id}`}>
              <div className="avatar" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}><Icon name="users" size={18} /></div>
              <div className="main">
                <div className="t">{g.name} <span className="badge">{t(g.kind === 'osusu' ? 'groups.osusuShort' : 'groups.duesShort')}</span></div>
                <div className="s">{g.members.length} · {formatMoney(g.amount)} {t(`groups.${g.frequency}`)} · {totalRounds(g) ? t('groups.roundOf', { r, max: totalRounds(g) }) : t('groups.round', { r })}</div>
                <div className="meter" style={{ marginTop: 6 }}><i style={{ width: `${pct}%` }} /></div>
              </div>
              <div className="amt num">{pct}%<small>{t('groups.unpaid', { count: s.unpaid.length })}</small></div>
            </Link>
          );
        }) : <Empty icon="users" title={t('groups.none')} text={t('groups.noneHelp')} />}
      </div>
    </Page>
  );
}

export function GroupDetail() {
  const { id } = useParams();
  const { t } = useTranslation();
  const book = useBook();
  const { ctx, can } = useApp();
  const { openSheet, toast, fail } = useOverlay();
  const { fmt } = useDate();
  const g = book.groups.find((x) => x.id === id);
  const [viewRound, setViewRound] = useState<number | null>(null);
  if (!g) return <Page title={t('err.notFound')} back="/groups"><Empty icon="users" title={t('err.notFound')} /></Page>;
  const max = totalRounds(g);
  const r = viewRound ?? currentRound(g);
  const s = roundStatus(book, g, r);
  const collector = collectorFor(g, r);
  const rel = memberReliability(book, g);
  const cc = book.org.country_code;
  const momo = book.org.momo_number ? ` ${book.org.momo_number}.` : '';
  const remindText = (name: string) => t('groups.remindMsg', { name, amount: formatMoney(g.amount), group: g.name, round: r, momo });
  const summaryText = `*${g.name}* · ${t('groups.round', { r })} (${fmt(roundDate(g, r))})\n${collector ? `${t('groups.collects')}: ${collector.name}\n` : ''}${t('groups.paidCount', { paid: s.paidIds.size, total: g.members.length })}\n\n${g.members.map((m) => `${s.paidIds.has(m.id) ? '✅' : '⏳'} ${m.name}`).join('\n')}\n\nKopor`;

  const tick = async (memberId: string) => {
    try { toast(t((await toggleContribution(ctx, g, memberId, r)) ? 'groups.marked' : 'groups.unmarked')); } catch (e) { fail(e); }
  };

  return (
    <Page title={g.name} sub={`${t(g.kind === 'osusu' ? 'groups.osusuShort' : 'groups.duesShort')} · ${formatMoney(g.amount)} ${t(`groups.${g.frequency}`)}`} back="/groups"
      right={can('groups') && <button className="icon-btn" aria-label={t('groups.edit')} onClick={() => openSheet(t('groups.edit'), <GroupSheet group={g} />)}><Icon name="edit" /></button>}>
      <div className="card">
        <div className="round-nav">
          <button className="icon-btn" disabled={r <= 1} onClick={() => setViewRound(r - 1)} aria-label="Previous round"><Icon name="back" /></button>
          <b>{max ? t('groups.roundOf', { r, max }) : t('groups.round', { r })}<div className="small muted">{fmt(roundDate(g, r))}</div></b>
          <button className="icon-btn" disabled={!!max && r >= max} onClick={() => setViewRound(r + 1)} aria-label="Next round"><Icon name="chev" /></button>
        </div>
        <div className="meter" style={{ margin: '12px 0 8px' }}><i style={{ width: `${s.expected ? (s.collected / s.expected) * 100 : 0}%` }} /></div>
        <div className="row between small"><span><b className="num">{formatMoney(s.collected)}</b> / {formatMoney(s.expected)}</span><span>{t('groups.paidCount', { paid: s.paidIds.size, total: g.members.length })}</span></div>
        {collector && (
          <div className="alert" style={{ marginTop: 12, background: 'var(--brand-soft)' }}><Icon name="cash" />
            <div className="stack" style={{ gap: 6 }}>
              <span>{t('groups.collectorLine', { name: collector.name, amount: formatMoney(s.expected) })}</span>
              {g.payouts[r] ? <span className="small good">{t('groups.paidOut', { date: fmt(g.payouts[r]) })}</span> : can('groups') && (
                <div className="btn-row">
                  <button className="btn sm primary" onClick={() => markPayout(ctx, g, r).catch(fail)}>{t('groups.markPayout')}</button>
                  {can('payouts') && collector.phone && <button className="btn sm" onClick={() => openSheet(t('groups.sendPot'), <PayoutSheet amount={s.expected} phone={collector.phone} note={`${g.name} ${t('groups.round', { r })}`} onDone={() => markPayout(ctx, g, r)} />)}>{t('groups.sendPot')}</button>}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="btn-row">
        <a className="btn" href={waLink('', summaryText, cc)} target="_blank" rel="noopener noreferrer"><Icon name="share" size={18} /> {t('groups.shareUpdate')}</a>
        {can('groups') && <button className="btn" onClick={() => openSheet(t('groups.members'), <MembersSheet group={g} />)}><Icon name="plus" size={18} /> {t('groups.members')}</button>}
      </div>
      <div className="list members">
        {g.members.length ? g.members.map((m, i) => (
          <div className="item" key={m.id}>
            <div className="avatar">{initials(m.name)}</div>
            <div className="main">
              <div className="t">{m.name} {collector?.id === m.id && <span className="badge good">{t('groups.collects')}</span>}</div>
              <div className="s">{g.kind === 'osusu' ? `${t('groups.turn', { n: i + 1 })} · ${fmt(roundDate(g, i + 1))}` : m.phone} · {t('groups.reliability', { pct: Math.round((rel.get(m.id) ?? 0) * 100) })}</div>
            </div>
            {!s.paidIds.has(m.id) && m.phone && <a className="icon-btn" href={waLink(m.phone, remindText(m.name), cc)} target="_blank" rel="noopener noreferrer" aria-label={`${t('credit.remind')} ${m.name}`}><Icon name="chat" size={18} /></a>}
            <button className={`tick ${s.paidIds.has(m.id) ? 'on' : ''}`} disabled={!can('record')} aria-pressed={s.paidIds.has(m.id)} aria-label={`${m.name}`} onClick={() => tick(m.id)}><Icon name="check" /></button>
          </div>
        )) : <Empty icon="users" title={t('groups.members')} text={t('groups.membersHelp')} />}
      </div>
      <div className="small muted" style={{ textAlign: 'center' }}>{t('groups.totalCollected', { amount: formatMoney(groupTotal(book, g)) })}</div>
    </Page>
  );
}

function GroupSheet({ group }: { group?: Group }) {
  const { t } = useTranslation();
  const { ctx } = useApp();
  const { closeSheet, toast, fail } = useOverlay();
  const nav = useNavigate();
  const [f, setF] = useState({ name: group?.name ?? '', kind: group?.kind ?? 'osusu', amount: group?.amount ?? 0, frequency: group?.frequency ?? 'weekly', start_date: group?.start_date ?? today(), members: '' });
  return (
    <form className="form" data-testid="group-form" onSubmit={async (e) => {
      e.preventDefault();
      try {
        const saved = await saveGroup(ctx, { ...f, members: [...(group?.members ?? []), ...parseMembers(f.members)] } as never, group?.id);
        closeSheet(); toast(t('common.saved')); nav(`/groups/${saved.id}`);
      } catch (err) { fail(err); }
    }}>
      <Field label={t('groups.name')}><input name="name" required autoFocus value={f.name} placeholder={t('groups.namePh')} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label={t('groups.kind')}>
        <select name="kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Group['kind'] })}>
          <option value="osusu">{t('groups.osusu')}</option><option value="dues">{t('groups.dues')}</option>
        </select>
      </Field>
      <div className="grid2">
        <Field label={t('groups.amount')}><MoneyInput name="amount" required value={f.amount} onChange={(amount) => setF({ ...f, amount })} /></Field>
        <Field label={t('groups.frequency')}>
          <select value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value as Group['frequency'] })}>
            {(['daily', 'weekly', 'monthly'] as const).map((k) => <option key={k} value={k}>{t(`groups.${k}`)}</option>)}
          </select>
        </Field>
      </div>
      <Field label={t('groups.start')}><input type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></Field>
      {!group && <Field label={t('groups.membersHelp')}><textarea name="members" value={f.members} onChange={(e) => setF({ ...f, members: e.target.value })} placeholder={'Fatmata Sesay, 076123456\nMohamed Bangura, 088123456'} /></Field>}
      <button className="btn primary block">{t('common.save')}</button>
      {group && <GroupDelete group={group} />}
    </form>
  );
}

function GroupDelete({ group }: { group: Group }) {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx } = useApp();
  const nav = useNavigate();
  return <DeleteButton label={t('groups.deleteGroup')} onDelete={async () => {
    await atomic(async () => {
      for (const c of book.contributions.filter((x) => x.group_id === group.id)) await remove(ctx, 'contributions', c.id);
      await remove(ctx, 'groups', group.id, `Deleted group ${group.name}`);
    });
    nav('/groups');
  }} />;
}

function MembersSheet({ group }: { group: Group }) {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx } = useApp();
  const { fail } = useOverlay();
  const g = book.groups.find((x) => x.id === group.id) ?? group;
  const [text, setText] = useState('');
  const save = (members: Group['members']) => update(ctx, 'groups', g.id, { members }, 'Group members').catch(fail);
  const move = (i: number, d: number) => {
    const m = [...g.members]; const j = i + d;
    if (j < 0 || j >= m.length) return;
    [m[i], m[j]] = [m[j], m[i]]; save(m);
  };
  return (
    <div className="form">
      <div className="list">
        {g.members.map((m, i) => (
          <div className="item" key={m.id}>
            <div className="main"><div className="t">{i + 1}. {m.name}</div><div className="s">{m.phone}</div></div>
            <button type="button" className="icon-btn" aria-label={t('groups.moveUp')} onClick={() => move(i, -1)}><Icon name="up" size={18} /></button>
            <button type="button" className="icon-btn" aria-label={t('groups.moveDown')} onClick={() => move(i, 1)}><Icon name="down" size={18} /></button>
            <button type="button" className="icon-btn" aria-label={t('common.delete')} onClick={() => confirm(t('common.confirm')) && save(g.members.filter((x) => x.id !== m.id))}><Icon name="trash" size={18} /></button>
          </div>
        ))}
      </div>
      <Field label={t('groups.membersHelp')}><textarea value={text} onChange={(e) => setText(e.target.value)} /></Field>
      <button type="button" className="btn primary block" onClick={() => { save([...g.members, ...parseMembers(text)]); setText(''); }}>{t('groups.addMembers')}</button>
    </div>
  );
}

/** Send money by mobile money via the business's Monime account (owner only). */
export function PayoutSheet({ amount: initial, phone: initialPhone = '', note: initialNote = '', onDone }: { amount: number; phone?: string; note?: string; onDone?: () => Promise<unknown> }) {
  const { t } = useTranslation();
  const { ctx } = useApp();
  const { closeSheet, toast, fail } = useOverlay();
  const [f, setF] = useState({ amount: initial, phone: initialPhone, note: initialNote, providerId: '' });
  const [providers, setProviders] = useState<{ id: string; name: string }[] | null>(null);
  useEffect(() => {
    momoProviders(ctx.orgId)
      .then((r) => { setProviders(r.providers); setF((x) => ({ ...x, providerId: r.providers[0]?.id ?? '' })); })
      .catch((e) => { setProviders([]); fail(e); });
  }, [ctx.orgId, fail]);
  return (
    <form className="form" onSubmit={async (e) => {
      e.preventDefault();
      if (!confirm(`${t('pay.payout')}: ${formatMoney(f.amount)} → ${f.phone}?`)) return;
      try { await createPayout(ctx.orgId, f); await onDone?.(); closeSheet(); toast(t('pay.sent')); } catch (err) { fail(err); }
    }}>
      <div className="small muted">{t('pay.payoutHelp')}</div>
      <Field label={t('common.amount')}><MoneyInput big required value={f.amount} onChange={(amount) => setF({ ...f, amount })} /></Field>
      <Field label={t('pay.recipient')}><input type="tel" required value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
      <Field label={t('pay.provider')}>
        <select required value={f.providerId} onChange={(e) => setF({ ...f, providerId: e.target.value })}>{(providers ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      </Field>
      <Field label={t('common.note')}><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      <button className="btn primary block" disabled={!providers?.length}><Icon name="send" size={18} /> {t('pay.payout')}</button>
    </form>
  );
}
