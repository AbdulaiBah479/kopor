// Osusu (rotating savings) and dues collection for associations, churches, schools.
import { S, save, remove, byId, currentRound, totalRounds, roundDate, roundContribs, collectorFor, groupStats, toggleContribution } from '../store.js';
import { esc, money, num, uid, today, fmtDate, initials, waLink } from '../util.js';
import { icon, actions, forms, sheet, closeSheet, toast, refresh, field, options, empty } from '../ui.js';

const FREQ = [['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly']];
const KINDS = [['osusu', 'Osusu (members take turns collecting the pot)'], ['dues', 'Dues / contributions (association, church, school, team)']];
const viewRound = {}; // group id -> round being viewed

export const routes = {
  groups() {
    const rows = S.groups.map((g) => {
      const s = groupStats(g);
      const pct = s.expected ? Math.round((s.collected / s.expected) * 100) : 0;
      return `<a class="item" href="#/group/${g.id}">
        <div class="avatar" style="background:var(--brand-soft);color:var(--brand)">${icon('users', 18)}</div>
        <div class="main"><div class="t">${esc(g.name)} <span class="badge">${g.kind === 'osusu' ? 'Osusu' : 'Dues'}</span></div>
          <div class="s">${g.members.length} members · ${money(g.amount)} ${g.frequency} · round ${s.round}${totalRounds(g) ? '/' + totalRounds(g) : ''}</div>
          <div class="meter" style="margin-top:6px"><i style="width:${pct}%"></i></div></div>
        <div class="amt num">${pct}%<small>${s.unpaid} unpaid</small></div>
      </a>`;
    }).join('');
    return {
      title: 'Osusu & Groups',
      sub: 'Savings groups, dues and contributions',
      back: '#/more',
      body: `
        <div class="card flat small">Run your <b>osusu</b>, association dues, church contributions or school fees here. Track who paid, whose turn it is, and send reminders on WhatsApp.</div>
        <div class="list">${rows || empty('users', 'No groups yet', 'Create your first osusu or dues group.')}</div>`,
      fab: `<button class="fab" data-act="editGroup">${icon('plus')} New group</button>`,
    };
  },

  group(id) {
    const g = byId('groups', id);
    if (!g) return { title: 'Not found', back: '#/groups', body: empty('users', 'Group not found', '') };
    const max = totalRounds(g);
    const r = viewRound[id] || currentRound(g);
    const paid = new Set(roundContribs(g, r).map((c) => c.memberId));
    const collected = roundContribs(g, r).reduce((s, c) => s + c.amount, 0);
    const expected = g.amount * g.members.length;
    const collector = collectorFor(g, r);
    const paidOut = g.payouts?.[r];
    const s = groupStats(g);

    const members = g.members.map((m, i) => `<div class="item">
      <div class="avatar">${esc(initials(m.name))}</div>
      <div class="main"><div class="t">${esc(m.name)} ${collector?.id === m.id ? '<span class="badge good">Collects this round</span>' : ''}</div>
        <div class="s">${g.kind === 'osusu' ? `Turn ${i + 1} · ${fmtDate(roundDate(g, i + 1))}` : esc(m.phone || '')}</div></div>
      ${!paid.has(m.id) && m.phone ? `<a class="icon-btn" href="${waLink(m.phone, remindText(g, m, r), S.settings.cc)}" target="_blank" rel="noopener" aria-label="Remind ${esc(m.name)}">${icon('chat', 18)}</a>` : ''}
      <button class="tick ${paid.has(m.id) ? 'on' : ''}" data-act="toggleContrib" data-group="${id}" data-member="${m.id}" data-round="${r}" aria-label="${esc(m.name)} paid" aria-pressed="${paid.has(m.id)}">${icon('check', 20)}</button>
    </div>`).join('');

    return {
      title: g.name,
      sub: `${g.kind === 'osusu' ? 'Osusu' : 'Dues'} · ${money(g.amount)} ${g.frequency}`,
      back: '#/groups',
      right: `<button class="icon-btn" data-act="editGroup" data-id="${id}" aria-label="Edit group">${icon('edit')}</button>`,
      body: `
        <div class="card">
          <div class="round-nav">
            <button class="icon-btn" data-act="round" data-id="${id}" data-r="${r - 1}" ${r <= 1 ? 'disabled' : ''} aria-label="Previous round">${icon('back')}</button>
            <b>Round ${r}${max ? ' of ' + max : ''}<div class="small muted">${fmtDate(roundDate(g, r))}</div></b>
            <button class="icon-btn" data-act="round" data-id="${id}" data-r="${r + 1}" ${max && r >= max ? 'disabled' : ''} aria-label="Next round">${icon('chev')}</button>
          </div>
          <div class="meter" style="margin:12px 0 8px"><i style="width:${expected ? (collected / expected) * 100 : 0}%"></i></div>
          <div class="row between small"><span><b class="num">${money(collected)}</b> of ${money(expected)}</span><span>${paid.size}/${g.members.length} paid</span></div>
          ${collector ? `<div class="alert" style="margin-top:12px;background:var(--brand-soft)">${icon('cash')}<div><b>${esc(collector.name)}</b> collects ${money(expected)} this round.
            ${paidOut ? `<div class="small good">Paid out on ${fmtDate(paidOut)}</div>` : `<button class="btn sm primary" style="margin-top:6px" data-act="payout" data-id="${id}" data-r="${r}">Mark pot as paid out</button>`}</div></div>` : ''}
        </div>
        <div class="btn-row">
          <a class="btn" href="${waLink('', summaryText(g, r), S.settings.cc)}" target="_blank" rel="noopener">${icon('share', 18)} Share update</a>
          <button class="btn" data-act="addMember" data-id="${id}">${icon('plus', 18)} Member</button>
        </div>
        <div class="list members">${members || empty('users', 'No members', 'Add members to start collecting.')}</div>
        <div class="small muted" style="text-align:center">Total collected since start: <b class="num">${money(s.all)}</b></div>`,
    };
  },
};

function remindText(g, m, r) {
  return `Hello ${m.name}, a reminder that your ${g.kind === 'osusu' ? 'osusu' : 'contribution'} of ${money(g.amount)} for ${g.name} (round ${r}) is due.${S.settings.momo ? ' Pay to ' + S.settings.momo + '.' : ''} Thank you!`;
}
function summaryText(g, r) {
  const paid = new Set(roundContribs(g, r).map((c) => c.memberId));
  const c = collectorFor(g, r);
  const lines = g.members.map((m) => `${paid.has(m.id) ? '✅' : '⏳'} ${m.name}`);
  return `*${g.name}* · Round ${r} (${fmtDate(roundDate(g, r))})\n${c ? `Collector: ${c.name}\n` : ''}Paid ${paid.size}/${g.members.length}\n\n${lines.join('\n')}\n\nSent with Kopor`;
}

actions.round = ({ id, r }) => { viewRound[id] = Number(r); refresh(); };
actions.toggleContrib = async ({ group, member, round }) => {
  const g = byId('groups', group);
  const on = await toggleContribution(g, member, Number(round));
  toast(on ? 'Marked as paid' : 'Payment removed');
  refresh();
};
actions.payout = async ({ id, r }) => {
  const g = byId('groups', id);
  g.payouts = { ...(g.payouts || {}), [r]: today() };
  await save('groups', g);
  toast('Payout recorded');
  refresh();
};

actions.editGroup = ({ id } = {}) => {
  const g = (id && byId('groups', id)) || { kind: 'osusu', frequency: 'weekly', startDate: today(), members: [] };
  sheet(id ? 'Edit group' : 'New group', `<form class="form" data-form="saveGroup">
    <input type="hidden" name="id" value="${esc(g.id || '')}">
    ${field('Group name', `<input name="name" required autofocus value="${esc(g.name || '')}" placeholder="e.g. Market Women Osusu">`)}
    ${field('Type', `<select name="kind">${options(KINDS, g.kind)}</select>`)}
    <div class="grid2">
      ${field('Amount per member', `<input name="amount" inputmode="decimal" required value="${esc(g.amount ?? '')}">`)}
      ${field('How often', `<select name="frequency">${options(FREQ, g.frequency)}</select>`)}
    </div>
    ${field('Start date', `<input type="date" name="startDate" value="${esc(g.startDate)}">`)}
    ${id ? '' : field('Members: one per line, "Name, phone" (order = collection turn)', `<textarea name="members" placeholder="Fatmata Sesay, 076123456&#10;Mohamed Bangura, 088123456"></textarea>`)}
    <button class="btn primary block" type="submit">Save group</button>
    ${id ? `<button class="btn danger block" type="button" data-act="deleteGroup" data-id="${id}">${icon('trash', 18)} Delete group</button>` : ''}
  </form>`);
};
forms.saveGroup = async (d) => {
  const g = (d.id && byId('groups', d.id)) || { members: [], payouts: {} };
  Object.assign(g, { name: d.name.trim(), kind: d.kind, amount: num(d.amount), frequency: d.frequency, startDate: d.startDate || today() });
  if (!(g.amount > 0)) throw new Error('Enter the amount each member pays');
  if (d.members) g.members.push(...parseMembers(d.members));
  await save('groups', g);
  closeSheet();
  toast('Group saved');
  location.hash = '#/group/' + g.id;
  refresh();
};
const parseMembers = (text) => text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
  const [name, phone = ''] = l.split(/[,;\t]/).map((x) => x.trim());
  return { id: uid(), name, phone };
});

actions.addMember = ({ id }) => {
  const g = byId('groups', id);
  sheet('Members', `<form class="form" data-form="saveMembers">
    <input type="hidden" name="id" value="${id}">
    <div class="list">${g.members.map((m, i) => `<div class="item">
      <div class="main"><div class="t">${i + 1}. ${esc(m.name)}</div><div class="s">${esc(m.phone || '')}</div></div>
      <button type="button" class="icon-btn" data-act="moveMember" data-id="${id}" data-i="${i}" data-dir="-1" aria-label="Move up">${icon('up', 18)}</button>
      <button type="button" class="icon-btn" data-act="moveMember" data-id="${id}" data-i="${i}" data-dir="1" aria-label="Move down">${icon('down', 18)}</button>
      <button type="button" class="icon-btn" data-act="removeMember" data-id="${id}" data-i="${i}" aria-label="Remove">${icon('trash', 18)}</button>
    </div>`).join('')}</div>
    ${field('Add members: one per line, "Name, phone"', `<textarea name="members" autofocus></textarea>`)}
    <button class="btn primary block" type="submit">Add</button>
  </form>`);
};
forms.saveMembers = async (d) => {
  const g = byId('groups', d.id);
  g.members.push(...parseMembers(d.members || ''));
  await save('groups', g);
  closeSheet();
  refresh();
};
actions.moveMember = async ({ id, i, dir }) => {
  const g = byId('groups', id);
  const a = Number(i), b = a + Number(dir);
  if (b < 0 || b >= g.members.length) return;
  [g.members[a], g.members[b]] = [g.members[b], g.members[a]];
  await save('groups', g);
  actions.addMember({ id });
  refresh();
};
actions.removeMember = async ({ id, i }) => {
  const g = byId('groups', id);
  if (!confirm(`Remove ${g.members[i].name}?`)) return;
  g.members.splice(Number(i), 1);
  await save('groups', g);
  actions.addMember({ id });
  refresh();
};
actions.deleteGroup = async ({ id }) => {
  if (!confirm('Delete this group and all its payment records?')) return;
  for (const c of S.contributions.filter((x) => x.groupId === id)) await remove('contributions', c.id);
  await remove('groups', id);
  closeSheet();
  location.hash = '#/groups';
};
