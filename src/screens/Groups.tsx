import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useApp, useBook } from '@/state/app';
import { useOverlay } from '@/ui/overlay';
import { Page } from '@/ui/Shell';
import { Icon } from '@/ui/Icon';
import { Empty, Field, Money, MoneyInput, initials, useDate } from '@/ui/widgets';
import { formatMoney } from '@/lib/money';
import { today, addDays } from '@/lib/dates';
import { publicLink } from '@/lib/links';
import { waLink } from '@/lib/phone';
import { update, remove, atomic } from '@/db/repo';
import type { Group } from '@/db/schema';
import { currentRound, totalRounds, roundDate, roundStatus, collectorFor, groupTotal, memberReliability, parseMembers, saveGroup, toggleContribution, markPayout,
  groupMoney, memberMoney, loanInterest, lendFromGroup, repayToGroup, shareOut, groupToken, pendingClaims, approveClaim, rejectClaim } from '@/domain/groups';
import { createPayout, momoProviders } from '@/cloud/payments';
import { DeleteButton } from './Credit';

const kindShort = (g: Group) => (g.kind === 'osusu' ? 'groups.osusuShort' : g.kind === 'savings' ? 'vsla.short' : 'groups.duesShort');

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
                <div className="t with-badge"><span className="trunc">{g.name}</span> <span className="badge">{t(kindShort(g))}</span></div>
                <div className="s">{g.members.length} · {formatMoney(g.amount)} {t(`groups.${g.frequency}`)} · {totalRounds(g) ? t('groups.roundOf', { r, max: totalRounds(g) }) : t('groups.round', { r })}</div>
                <div className="meter" style={{ marginTop: 6 }}><i style={{ width: `${pct}%` }} /></div>
              </div>
              <div className="amt num">{pct}%<small>{pendingClaims(book, g.id).length ? t('claims.waiting', { count: pendingClaims(book, g.id).length }) : t('groups.unpaid', { count: s.unpaid.length })}</small></div>
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
    // Every tap can be undone from the popup, so a slip of the finger never loses a payment.
    try {
      const paid = await toggleContribution(ctx, g, memberId, r);
      toast(t(paid ? 'groups.marked' : 'groups.unmarked'), { undo: () => toggleContribution(ctx, g, memberId, r) });
    } catch (e) { fail(e); }
  };

  return (
    <Page title={g.name} sub={`${t(kindShort(g))} · ${formatMoney(g.amount)} ${t(`groups.${g.frequency}`)}`} back="/groups"
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
                  {can('payouts') && collector.phone && <button className="btn sm" onClick={() => openSheet(t('groups.sendPot'), <PayoutSheet amount={s.collected || s.expected} phone={collector.phone} note={`${g.name} ${t('groups.round', { r })}`} onDone={() => markPayout(ctx, g, r)} />)}>{t('groups.sendPot')}</button>}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      <ClaimsCard group={g} />
      {g.kind === 'savings' && <PotCard group={g} />}
      {g.kind === 'dues' && g.target ? <TargetCard group={g} /> : null}
      <div className="btn-row">
        <a className="btn" href={waLink('', summaryText, cc)} target="_blank" rel="noopener noreferrer"><Icon name="share" size={18} /> {t('groups.shareUpdate')}</a>
        {can('groups') && <button className="btn" onClick={() => openSheet(t('groups.members'), <MembersSheet group={g} />)}><Icon name="plus" size={18} /> {t('groups.members')}</button>}
      </div>
      <button className="btn ghost block" data-testid="group-link" onClick={() => openSheet(t('vsla.linkTitle'), <GroupLinkSheet group={g} />)}><Icon name="link" size={18} /> {t('vsla.link')}</button>
      <div className="list members">
        {g.members.length ? g.members.map((m, i) => (
          <div className="item" key={m.id}>
            <div className="avatar">{initials(m.name)}</div>
            <div className="main">
              <div className="t with-badge"><span className="trunc">{m.name}</span> {collector?.id === m.id && <span className="badge good">{t('groups.collects')}</span>}</div>
              <div className="s">{[g.kind === 'osusu' ? `${t('groups.turn', { n: i + 1 })} · ${fmt(roundDate(g, i + 1))}` : m.phone, t('groups.reliability', { pct: Math.round((rel.get(m.id) ?? 0) * 100) })].filter(Boolean).join(' · ')}</div>
              {g.kind === 'savings' && <MemberBalance group={g} memberId={m.id} />}
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

/** Members' "I've paid" from the group link, waiting for the treasurer: approve (it then counts) or reject. */
function ClaimsCard({ group: g }: { group: Group }) {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx, can } = useApp();
  const { toast, fail } = useOverlay();
  const { fmt } = useDate();
  const claims = pendingClaims(book, g.id);
  if (!claims.length) return null;
  const name = (id: string) => g.members.find((m) => m.id === id)?.name ?? '?';
  return (
    <div className="card stack" data-testid="claims">
      <h2><Icon name="bell" size={18} /> {t('claims.title', { count: claims.length })}</h2>
      <div className="small muted">{t('claims.help')}</div>
      <div className="list">
        {claims.map((c) => (
          <div key={c.id} className="item" data-claim={name(c.member_id)}>
            <div className="main">
              <div className="t">{name(c.member_id)} · <span className="num">{formatMoney(c.amount)}</span></div>
              <div className="s">{c.kind === 'repay' ? t('claims.repay') : t('groups.round', { r: c.round ?? currentRound(g) })} · {t(`methods.${c.method}`)}{c.ref ? ` · ${c.ref}` : ''} · {fmt(new Date(c.created_at).toISOString().slice(0, 10))}</div>
              {c.note && <div className="s">{c.note}</div>}
              {can('record') && (
                <div className="btn-row" style={{ marginTop: 8 }}>
                  <button className="btn sm primary" data-testid="claim-approve" onClick={() => approveClaim(ctx, book, c.id).then(() => toast(t('claims.approved'))).catch(fail)}><Icon name="check" size={16} /> {t('claims.approve')}</button>
                  <button className="btn sm" onClick={() => confirm(t('claims.rejectConfirm')) && rejectClaim(ctx, c.id).then(() => toast(t('claims.rejected'))).catch(fail)}>{t('claims.reject')}</button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Savings & loan group: what is in the box, what is lent out, and the Lend / Share out actions. */
function PotCard({ group: g }: { group: Group }) {
  const { t } = useTranslation();
  const book = useBook();
  const { can } = useApp();
  const { openSheet } = useOverlay();
  const m = groupMoney(book, g);
  return (
    <div className="card stack" data-testid="pot-card">
      <div className="grid3">
        <div className="stat"><div className="k">{t('vsla.inBox')}</div><div className="v"><Money compact v={m.inBox} /></div></div>
        <div className="stat"><div className="k">{t('vsla.lentOut')}</div><div className="v"><Money compact v={m.owed} /></div></div>
        <div className="stat"><div className="k">{t('vsla.worth')}</div><div className="v"><Money compact v={m.worth} className="good" /></div></div>
      </div>
      <div className="small muted">{t('vsla.potHelp', { pct: g.loan_interest ?? 10 })}</div>
      {g.target ? <Progress label={t('vsla.toTarget', { target: formatMoney(g.target) })} value={m.worth} target={g.target} /> : null}
      <div className="btn-row">
        {can('groups') && <button className="btn primary" data-testid="lend" onClick={() => openSheet(t('vsla.lend'), <LendSheet group={g} />)}><Icon name="send" size={18} /> {t('vsla.lend')}</button>}
        <button className="btn" data-testid="share-out" onClick={() => openSheet(t('vsla.shareOut'), <ShareOutSheet group={g} />)}><Icon name="users" size={18} /> {t('vsla.shareOut')}</button>
      </div>
    </div>
  );
}

function TargetCard({ group: g }: { group: Group }) {
  const { t } = useTranslation();
  const book = useBook();
  return <div className="card"><Progress label={t('vsla.toTarget', { target: formatMoney(g.target!) })} value={groupTotal(book, g)} target={g.target!} /></div>;
}

function Progress({ label, value, target }: { label: string; value: number; target: number }) {
  const pct = Math.min(100, Math.round((value / target) * 100));
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row between small"><span>{label}</span><b className="num">{pct}%</b></div>
      <div className="meter" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}><i style={{ width: `${pct}%` }} /></div>
      <div className="small muted num">{formatMoney(value)} / {formatMoney(target)}</div>
    </div>
  );
}

/** One member's savings and loan, with Repay when they owe. */
function MemberBalance({ group: g, memberId }: { group: Group; memberId: string }) {
  const { t } = useTranslation();
  const book = useBook();
  const { can } = useApp();
  const { openSheet } = useOverlay();
  const { fmt } = useDate();
  const mm = memberMoney(book, g, memberId);
  return (
    <div className="small" style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      <span>{t('vsla.saved')} <b className="num">{formatMoney(mm.saved)}</b></span>
      {mm.owes > 0 && <span className={mm.overdue ? 'bad' : ''}>{t('vsla.owes')} <b className="num">{formatMoney(mm.owes)}</b>{mm.due ? ` · ${t('vsla.due', { date: fmt(mm.due) })}` : ''}</span>}
      {mm.owes > 0 && can('record') && <button className="btn sm tinted" data-testid="repay" onClick={() => openSheet(t('vsla.repay'), <RepaySheet group={g} memberId={memberId} />)}>{t('vsla.repay')}</button>}
    </div>
  );
}

function LendSheet({ group: g }: { group: Group }) {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx } = useApp();
  const { closeSheet, toast, fail } = useOverlay();
  const [f, setF] = useState({ memberId: g.members[0]?.id ?? '', amount: 0, dueDate: addDays(today(), 28) });
  const interest = loanInterest(g, f.amount);
  return (
    <form className="form" data-testid="lend-form" onSubmit={async (e) => {
      e.preventDefault();
      try { await lendFromGroup(ctx, book, g, f); closeSheet(); toast(t('vsla.lent')); } catch (err) { fail(err); }
    }}>
      <div className="small muted">{t('vsla.lendHelp', { amount: formatMoney(groupMoney(book, g).inBox) })}</div>
      <Field label={t('vsla.member')}><select value={f.memberId} onChange={(e) => setF({ ...f, memberId: e.target.value })}>{g.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
      <Field label={t('common.amount')}><MoneyInput name="amount" big required value={f.amount} onChange={(amount) => setF({ ...f, amount })} /></Field>
      <Field label={t('common.dueDate')}><input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
      {f.amount > 0 && <div className="card flat small">{t('vsla.toRepay', { amount: formatMoney(f.amount + interest), interest: formatMoney(interest), pct: g.loan_interest ?? 10 })}</div>}
      <button className="btn primary block">{t('vsla.lend')}</button>
    </form>
  );
}

function RepaySheet({ group: g, memberId }: { group: Group; memberId: string }) {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx } = useApp();
  const { closeSheet, toast, fail } = useOverlay();
  const owes = memberMoney(book, g, memberId).owes;
  const [amount, setAmount] = useState(owes);
  return (
    <form className="form" data-testid="repay-form" onSubmit={async (e) => {
      e.preventDefault();
      try { await repayToGroup(ctx, book, g, memberId, amount); closeSheet(); toast(t('vsla.repaid')); } catch (err) { fail(err); }
    }}>
      <div className="small muted">{t('vsla.owesTotal', { name: g.members.find((m) => m.id === memberId)?.name ?? '', amount: formatMoney(owes) })}</div>
      <Field label={t('common.amount')}><MoneyInput name="amount" big required value={amount} onChange={setAmount} /></Field>
      <button className="btn primary block">{t('vsla.repay')}</button>
    </form>
  );
}

/** What each member takes home: their savings plus their share of the interest (the cash in the box, by savings). */
function ShareOutSheet({ group: g }: { group: Group }) {
  const { t } = useTranslation();
  const book = useBook();
  const s = shareOut(book, g);
  const text = `*${g.name}* · ${t('vsla.shareOut')}\n\n${s.rows.map((r) => `${r.member.name}: ${formatMoney(r.share)} (${t('vsla.saved')} ${formatMoney(r.saved)})`).join('\n')}\n\n${t('vsla.inBox')}: ${formatMoney(s.inBox)}\nKopor`;
  return (
    <div className="stack" data-testid="share-out-sheet">
      <div className="small muted">{t('vsla.shareHelp')}</div>
      {s.stillOwed > 0 && <div className="alert small"><Icon name="alert" /><div>{t('vsla.stillOwed', { amount: formatMoney(s.stillOwed) })}</div></div>}
      <div className="list">
        {s.rows.map((r) => (
          <div className="item" key={r.member.id}>
            <div className="main"><div className="t">{r.member.name}</div><div className="s">{t('vsla.saved')} {formatMoney(r.saved)}{r.earned > 0 ? ` · +${formatMoney(r.earned)}` : ''}</div></div>
            <div className="amt num">{formatMoney(r.share)}</div>
          </div>
        ))}
      </div>
      <div className="row between"><b>{t('vsla.inBox')}</b><b className="num">{formatMoney(s.inBox)}</b></div>
      <a className="btn get block" href={waLink('', text, book.org.country_code)} target="_blank" rel="noopener noreferrer"><Icon name="chat" size={18} /> {t('common.whatsapp')}</a>
    </div>
  );
}

/** Member link: every member sees the group, whose turn it is, who has paid and their own balance on their phone. */
function GroupLinkSheet({ group }: { group: Group }) {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx, can, sync, requestSync } = useApp();
  const { toast, fail } = useOverlay();
  const [token, setToken] = useState<string | null>(group.public_token ?? null);
  const started = useRef(false);
  useEffect(() => {
    if (token || started.current) return;
    started.current = true;
    groupToken(ctx, group).then((tk) => { setToken(tk); requestSync(); }).catch(fail);
  }, [ctx, group, token, fail, requestSync]);
  const link = token ? publicLink(`/g/${token}`) : '';
  const msg = t('vsla.linkMsg', { group: group.name, link });
  return (
    <div className="stack" data-testid="group-link-sheet">
      <div className="small muted">{t('vsla.linkHelp')}</div>
      {sync.status === 'off' && <div className="alert small"><Icon name="alert" /><div>{t('stmt.needCloud')}</div></div>}
      <input className="input" readOnly value={link} aria-label={t('vsla.link')} data-testid="group-link-url" onFocus={(e) => e.target.select()} />
      <a className="btn get block" target="_blank" rel="noopener noreferrer" href={waLink('', msg, book.org.country_code)}><Icon name="chat" size={18} /> {t('stmt.share')}</a>
      <button type="button" className="btn block" disabled={!token} onClick={() => navigator.clipboard?.writeText(link).then(() => toast(t('common.copied'))).catch(() => {})}><Icon name="link" size={18} /> {t('stmt.copy')}</button>
      {can('groups') && token && <button type="button" className="btn ghost block" onClick={() => confirm(t('stmt.renewHelp')) && groupToken(ctx, group, true).then((tk) => { setToken(tk); requestSync(); toast(t('stmt.renewed')); }).catch(fail)}>{t('stmt.renew')}</button>}
    </div>
  );
}

function GroupSheet({ group }: { group?: Group }) {
  const { t } = useTranslation();
  const { ctx } = useApp();
  const { closeSheet, toast, fail } = useOverlay();
  const nav = useNavigate();
  const [f, setF] = useState({
    name: group?.name ?? '', kind: group?.kind ?? 'osusu', amount: group?.amount ?? 0, frequency: group?.frequency ?? 'weekly', start_date: group?.start_date ?? today(),
    members: '', target: group?.target ?? 0, loan_interest: group?.loan_interest ?? 10,
  });
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
          <option value="osusu">{t('groups.osusu')}</option><option value="dues">{t('groups.dues')}</option><option value="savings">{t('vsla.kind')}</option>
        </select>
      </Field>
      {f.kind === 'savings' && <div className="small muted">{t('vsla.kindHelp')}</div>}
      <div className="grid2">
        <Field label={t('groups.amount')}><MoneyInput name="amount" required value={f.amount} onChange={(amount) => setF({ ...f, amount })} /></Field>
        <Field label={t('groups.frequency')}>
          <select value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value as Group['frequency'] })}>
            {(['daily', 'weekly', 'monthly'] as const).map((k) => <option key={k} value={k}>{t(`groups.${k}`)}</option>)}
          </select>
        </Field>
      </div>
      <Field label={t('groups.start')}><input type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></Field>
      {f.kind !== 'osusu' && <Field label={t('vsla.target')}><MoneyInput name="target" value={f.target} onChange={(target) => setF({ ...f, target })} /></Field>}
      {f.kind === 'savings' && (
        <Field label={t('vsla.interest')}><input name="loan_interest" type="number" inputMode="decimal" min="0" max="100" step="0.5" value={f.loan_interest}
          onChange={(e) => setF({ ...f, loan_interest: Number(e.target.value) })} /></Field>
      )}
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
      for (const l of book.groupLoans.filter((x) => x.group_id === group.id)) await remove(ctx, 'group_loans', l.id);
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
