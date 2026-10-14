import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { useApp, useBook } from '@/state/app';
import { useOverlay } from '@/ui/overlay';
import { Page } from '@/ui/Shell';
import { Icon } from '@/ui/Icon';
import { Empty, Field, initials } from '@/ui/widgets';
import { db, type Member, type Role } from '@/db/schema';
import { ROLES } from '@/db/permissions';
import { saveMember, deactivateMember, addBranch, setPin, hasPin } from '@/domain/org';

export function Team() {
  const { t } = useTranslation();
  const book = useBook();
  const { can, member, lock } = useApp();
  const { openSheet } = useOverlay();
  const [pins, setPins] = useState<Set<string>>(new Set());
  useEffect(() => {
    Promise.all(book.members.map(async (m) => [m.id, await hasPin(m.id)] as const)).then((r) => setPins(new Set(r.filter((x) => x[1]).map((x) => x[0]))));
  }, [book.members]);
  const branchName = (id: string | null) => (id ? book.branches.find((b) => b.id === id)?.name : t('team.allBranches'));

  return (
    <Page guide="team" title={t('team.title')} sub={t('team.sub')} back="/more"
      right={pins.size > 0 && <button className="icon-btn" aria-label={t('team.switchUser')} onClick={lock}><Icon name="lock" /></button>}>
      <div className="row between"><h3 style={{ fontSize: 15 }}>{t('team.staff')}</h3>
        {can('team') && <button className="btn sm primary" onClick={() => openSheet(t('team.addStaff'), <MemberSheet />)}><Icon name="plus" size={16} /> {t('team.addStaff')}</button>}</div>
      <div className="list">
        {book.members.map((m) => (
          <button key={m.id} type="button" className="item" style={{ width: '100%', border: 0, textAlign: 'left', font: 'inherit', opacity: m.active ? 1 : 0.5 }}
            onClick={() => (can('team') || m.id === member?.id) && openSheet(m.name, <MemberSheet member={m} />)}>
            <div className="avatar">{initials(m.name)}</div>
            <div className="main">
              <div className="t">{m.name} {m.id === member?.id && <span className="badge good">{t('team.you')}</span>} {!m.active && <span className="badge">{t('team.inactive')}</span>}</div>
              <div className="s">{t(`roles.${m.role}`)} · {branchName(m.branch_id)}{m.phone && ` · ${m.phone}`}{pins.has(m.id) && ' · 🔒'}{m.user_id && ' · ☁'}</div>
            </div>
            <Icon name="chev" />
          </button>
        ))}
      </div>
      <div className="row between"><h3 style={{ fontSize: 15 }}>{t('team.branches')}</h3>
        {can('team') && <button className="btn sm" onClick={() => openSheet(t('team.addBranch'), <BranchSheet />)}><Icon name="plus" size={16} /> {t('team.addBranch')}</button>}</div>
      <div className="list">{book.branches.map((b) => <div key={b.id} className="item"><div className="avatar"><Icon name="store" size={18} /></div><div className="main"><div className="t">{b.name}</div><div className="s">{b.address}</div></div></div>)}</div>
      {can('reports') && <a className="btn block" href="#/audit"><Icon name="list" size={18} /> {t('team.audit')}</a>}
    </Page>
  );
}

function MemberSheet({ member }: { member?: Member }) {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx, can, member: me } = useApp();
  const { closeSheet, toast, fail } = useOverlay();
  const [f, setF] = useState({ name: member?.name ?? '', phone: member?.phone ?? '', role: (member?.role ?? 'cashier') as Role, branch_id: member?.branch_id ?? null as string | null });
  const [pin, setPinText] = useState('');
  const isMe = member?.id === me?.id;
  return (
    <form className="form" onSubmit={async (e) => {
      e.preventDefault();
      try {
        if (can('team')) {
          const saved = await saveMember(ctx, f, member?.id);
          if (pin) await setPin(saved.id, pin);
        } else if (isMe && pin) await setPin(member!.id, pin);
        closeSheet(); toast(t('common.saved'));
      } catch (err) { fail(err); }
    }}>
      {can('team') && (
        <>
          <Field label={t('common.name')}><input required autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label={t('common.phone')} hint={t('team.inviteHelp')}><input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label={t('team.role')}>
            <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>{ROLES.map((r) => <option key={r} value={r}>{t(`roles.${r}`)} · {t(`roleHelp.${r}`)}</option>)}</select>
          </Field>
          <Field label={t('team.branch')}>
            <select value={f.branch_id ?? ''} onChange={(e) => setF({ ...f, branch_id: e.target.value || null })}>
              <option value="">{t('team.allBranches')}</option>{book.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
        </>
      )}
      <Field label={t('team.setPin')}><input type="password" inputMode="numeric" pattern="\d{4,8}" maxLength={8} value={pin} onChange={(e) => setPinText(e.target.value.replace(/\D/g, ''))} autoComplete="new-password" /></Field>
      <button className="btn primary block">{t('common.save')}</button>
      {member && can('team') && !isMe && member.active === 1 && (
        <button type="button" className="btn danger block" onClick={() => confirm(t('common.confirm')) && deactivateMember(ctx, member.id).then(closeSheet).catch(fail)}>{t('team.remove')}</button>
      )}
    </form>
  );
}

function BranchSheet() {
  const { t } = useTranslation();
  const { ctx } = useApp();
  const { closeSheet, fail } = useOverlay();
  const [name, setName] = useState('');
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); addBranch(ctx, name).then(closeSheet).catch(fail); }}>
      <Field label={t('team.branchName')}><input required autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <button className="btn primary block">{t('common.save')}</button>
    </form>
  );
}

export function Audit() {
  const { t } = useTranslation();
  const { ctx } = useApp();
  const rows = useLiveQuery(() => db.audit.where('org_id').equals(ctx.orgId).reverse().sortBy('at').then((r) => r.slice(0, 300)), [ctx.orgId]);
  return (
    <Page title={t('team.audit')} sub={t('team.auditSub')} back="/team">
      <div className="list">
        {rows?.length ? rows.map((a) => (
          <div key={a.id} className="item audit-row">
            <div className="avatar">{initials(a.member_name || '?')}</div>
            <div className="main"><div className="t">{a.summary || `${a.action} ${a.entity}`}</div>
              <div className="s">{a.member_name} · {new Date(a.at).toLocaleString()}</div></div>
          </div>
        )) : <Empty icon="list" title={t('team.audit')} />}
      </div>
    </Page>
  );
}
