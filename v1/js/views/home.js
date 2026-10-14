import { S, summary, creditTotals, health, lowStock, isOverdue, dailySeries, groupStats, balance } from '../store.js';
import { esc, money, today, addDays } from '../util.js';
import { icon, barChart, scoreRing } from '../ui.js';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export const routes = {
  home() {
    const t = today();
    const day = summary(t, t);
    const month = summary(t.slice(0, 8) + '01', t);
    const credit = creditTotals();
    const h = health();
    const low = lowStock();
    const overdue = S.contacts.filter((c) => isOverdue(c.id));
    const groupsDue = S.groups.map((g) => ({ g, s: groupStats(g) })).filter((x) => x.s.unpaid > 0);

    const alerts = [];
    if (overdue.length) {
      const total = overdue.reduce((s, c) => s + balance(c.id), 0);
      alerts.push(`<a class="alert bad" href="#/credit/overdue">${icon('alert')}<div><b>${overdue.length} overdue debt${overdue.length > 1 ? 's' : ''}</b>, ${money(total)} to collect. Tap to send reminders.</div></a>`);
    }
    if (low.length) alerts.push(`<a class="alert" href="#/stock/low">${icon('box')}<div><b>Low stock:</b> ${esc(low.slice(0, 3).map((p) => p.name).join(', '))}${low.length > 3 ? ` +${low.length - 3} more` : ''}</div></a>`);
    for (const { g, s } of groupsDue.slice(0, 2)) {
      alerts.push(`<a class="alert" href="#/group/${g.id}">${icon('users')}<div><b>${esc(g.name)}:</b> ${s.unpaid} member${s.unpaid > 1 ? 's have' : ' has'} not paid round ${s.round}.</div></a>`);
    }

    const body = `
      <div class="hero">
        <div class="label">Today's profit</div>
        <div class="big num">${money(day.profit)}</div>
        <div class="mini">
          <div><span>Sales today</span><b class="num">${money(day.sales)}</b></div>
          <div><span>Expenses today</span><b class="num">${money(day.exp)}</b></div>
        </div>
      </div>

      <div class="quick">
        <button data-act="newSale"><span class="qi">${icon('plus')}</span>Sale</button>
        <button data-act="newExpense"><span class="qi out">${icon('minus')}</span>Expense</button>
        <button data-act="newCredit"><span class="qi">${icon('book')}</span>Credit</button>
        <button data-act="voice"><span class="qi ai">${icon('mic')}</span>Speak</button>
      </div>

      ${alerts.join('')}

      <div class="grid2">
        <a class="stat" href="#/credit"><div class="k">You will get</div><div class="v num good">${money(credit.get)}</div></a>
        <a class="stat" href="#/credit"><div class="k">You will give</div><div class="v num bad">${money(credit.give)}</div></a>
      </div>

      <div class="card">
        <h3>Last 7 days <a class="right" href="#/cash">Cash book ${icon('chev', 14)}</a></h3>
        ${barChart(dailySeries(7))}
      </div>

      <a class="card row" href="#/health" style="color:inherit">
        ${scoreRing(h.score)}
        <div class="spacer">
          <div class="muted small">Business health score</div>
          <div style="font-size:18px;font-weight:750">${h.label}</div>
          <div class="small muted">This month: ${money(month.sales)} sales, ${money(month.profit)} profit</div>
        </div>
        ${icon('chev')}
      </a>

      <div class="grid3">
        <a class="stat" href="#/groups"><div class="k">Osusu & groups</div><div class="v num">${S.groups.length}</div></a>
        <a class="stat" href="#/invoices"><div class="k">Unpaid invoices</div><div class="v num">${S.invoices.filter((i) => i.status !== 'paid').length}</div></a>
        <a class="stat" href="#/stock"><div class="k">Products</div><div class="v num">${S.products.length}</div></a>
      </div>`;

    return {
      title: S.settings.business || 'Kopor',
      sub: `${greeting()}${S.settings.owner ? ', ' + S.settings.owner.split(' ')[0] : ''}`,
      right: `<a class="icon-btn" href="#/settings" aria-label="Settings">${icon('sliders')}</a>`,
      body,
    };
  },
};
