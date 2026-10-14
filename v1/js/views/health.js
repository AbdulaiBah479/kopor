// Business health score and the printable loan-readiness report.
import { S, health, monthlySeries, creditTotals, stockValue, topProducts, summary } from '../store.js';
import { esc, money, today, addDays, fmtDate, monthLabel, refCode } from '../util.js';
import { icon, scoreRing } from '../ui.js';

export const routes = {
  health() {
    const h = health();
    const parts = h.parts.map((p) => `<div class="stack" style="gap:4px">
      <div class="row between"><b>${p.label}</b><span class="num small">${Math.round(p.score)} / ${p.max}</span></div>
      <div class="meter"><i style="width:${(p.score / p.max) * 100}%"></i></div>
      <div class="small muted">${esc(p.tip)}</div>
    </div>`).join('');
    return {
      title: 'Business Health',
      sub: 'How strong your business looks to lenders',
      back: '#/more',
      body: `
        <div class="card row">
          ${scoreRing(h.score, 96)}
          <div><div style="font-size:22px;font-weight:800">${h.label}</div>
            <div class="small muted">Updated from your records today. Record daily to raise your score.</div></div>
        </div>
        <div class="card stack" style="gap:16px">${parts}</div>
        <a class="btn primary block" href="#/report">${icon('bank', 18)} Open loan-ready report</a>
        <div class="card flat small">Banks and microfinance lenders ask for proof of income. Your Kopor report shows 3 months of sales, expenses, profit and credit history, with a verification code.</div>`,
    };
  },

  report() {
    const st = S.settings;
    const h = health();
    const months = monthlySeries(3);
    const from = addDays(today(), -89);
    const q = summary(from, today());
    const credit = creditTotals();
    const avg = q.sales / 3;
    const top = topProducts(from, today(), 5);
    const code = refCode([st.business, today(), q.sales, q.exp, h.score].join('|'));
    return {
      title: 'Loan-ready report',
      back: '#/health',
      body: `
        <div class="doc">
          <div class="row between" style="align-items:flex-start">
            <div><h2>${esc(st.business || 'My Business')}</h2>
              <div class="small">${esc(st.type || '')}${st.address ? ' · ' + esc(st.address) : ''}<br>${esc(st.owner || '')}${st.phone ? ' · ' + esc(st.phone) : ''}</div></div>
            <div style="text-align:right"><b>BUSINESS PERFORMANCE REPORT</b><div class="small">${fmtDate(from)} to ${fmtDate(today())}</div></div>
          </div>
          <table>
            <thead><tr><th>Month</th><th class="r">Sales</th><th class="r">Expenses</th><th class="r">Profit</th></tr></thead>
            <tbody>${months.map((m) => `<tr><td>${monthLabel(m.month)}</td><td class="r">${money(m.sales)}</td><td class="r">${money(m.exp)}</td><td class="r">${money(m.profit)}</td></tr>`).join('')}
              <tr class="tot"><td>Last 90 days</td><td class="r">${money(q.sales)}</td><td class="r">${money(q.exp)}</td><td class="r">${money(q.profit)}</td></tr></tbody>
          </table>
          <table>
            <tbody>
              <tr><td>Average monthly sales</td><td class="r"><b>${money(avg)}</b></td></tr>
              <tr><td>Profit margin (90 days)</td><td class="r"><b>${q.sales ? Math.round((q.profit / q.sales) * 100) : 0}%</b></td></tr>
              <tr><td>Money customers owe the business</td><td class="r">${money(credit.get)}</td></tr>
              <tr><td>Money the business owes suppliers</td><td class="r">${money(credit.give)}</td></tr>
              <tr><td>Stock value (at cost)</td><td class="r">${money(stockValue())}</td></tr>
              <tr><td>Transactions recorded (90 days)</td><td class="r">${q.count}</td></tr>
              <tr><td>Days with records (last 30)</td><td class="r">${h.activeDays}</td></tr>
              <tr><td><b>Kopor health score</b></td><td class="r"><b>${h.score}/100 (${h.label})</b></td></tr>
            </tbody>
          </table>
          ${top.length ? `<div class="small"><b>Top products:</b> ${top.map((p) => esc(p.name)).join(', ')}</div>` : ''}
          <div class="foot">Prepared from the business's own daily records in Kopor on ${fmtDate(today())}. Verification code: <b>${code}</b>.
            Figures are self-recorded by the business owner and have not been audited.</div>
        </div>
        <button class="btn primary block no-print" data-act="print">${icon('print', 18)} Print or save as PDF</button>`,
    };
  },
};
