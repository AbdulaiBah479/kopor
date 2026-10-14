// Entry point: loads data, routes by URL hash, wires delegated events.
import { S, load } from './store.js';
import { setCurrency, esc } from './util.js';
import { actions, forms, inputs, hooks, icon, toast, initChartTips, closeSheet } from './ui.js';
import * as home from './views/home.js';
import * as credit from './views/credit.js';
import * as cash from './views/cash.js';
import * as stock from './views/stock.js';
import * as groups from './views/groups.js';
import * as invoices from './views/invoices.js';
import * as healthView from './views/health.js';
import * as more from './views/more.js';
import './views/ai.js';

const routes = { ...home.routes, ...credit.routes, ...cash.routes, ...stock.routes, ...groups.routes, ...invoices.routes, ...healthView.routes, ...more.routes };
const TAB_OF = { contact: 'credit', groups: 'more', group: 'more', invoices: 'more', invoice: 'more', health: 'more', report: 'more', settings: 'more' };
const TABS = [['home', 'home', 'Home'], ['credit', 'book', 'Credit'], ['cash', 'cash', 'Cash'], ['stock', 'box', 'Stock'], ['more', 'grid', 'More']];

function parseHash() {
  const [name, ...args] = location.hash.replace(/^#\/?/, '').split('/').filter((x, i) => x || i === 0);
  return { name: routes[name] ? name : 'home', args: args.map(decodeURIComponent) };
}

let lastRoute = '';
function render() {
  const app = document.getElementById('app');
  if (more.lockState.locked) { app.innerHTML = more.lockView(); return; }
  if (!S.settings.onboarded) { app.innerHTML = more.onboardingView(); return; }

  const { name, args } = parseHash();
  const v = routes[name](...args);
  const tab = TAB_OF[name] || name;
  document.title = `${v.title} · Kopor`;
  app.innerHTML = `<div class="shell">
    <header class="topbar">
      ${v.back ? `<a class="icon-btn" href="${v.back}" aria-label="Back">${icon('back')}</a>` : ''}
      <h1>${esc(v.title)}${v.sub ? `<span class="sub">${esc(v.sub)}</span>` : ''}</h1>
      ${v.right || ''}
    </header>
    <main class="content">${v.body}</main>
    ${v.fab || ''}${v.after || ''}
  </div>
  <nav class="nav" aria-label="Main"><div class="nav-inner">${TABS.map(([r, ic, label]) =>
    `<a href="#/${r}" class="${tab === r ? 'on' : ''}" ${tab === r ? 'aria-current="page"' : ''}>${icon(ic, 22)}${label}</a>`).join('')}</div></nav>`;

  const key = location.hash;
  if (key !== lastRoute) { window.scrollTo(0, 0); lastRoute = key; }
}
hooks.render = render;

function wireEvents() {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const fn = actions[el.dataset.act];
    if (!fn) return;
    e.preventDefault();
    Promise.resolve(fn({ ...el.dataset }, el)).catch((err) => { console.error(err); toast(err.message || 'Something went wrong'); });
  });

  document.addEventListener('submit', async (e) => {
    const form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    const fn = forms[form.dataset.form];
    if (!fn) return;
    const fd = new FormData(form);
    const data = Object.fromEntries(fd);
    data._fd = fd;
    const btn = form.querySelector('[type=submit]');
    if (btn) btn.disabled = true;
    try { await fn(data, form); }
    catch (err) { console.error(err); toast(err.message || 'Something went wrong'); }
    finally { if (btn && document.body.contains(btn)) btn.disabled = false; }
  });

  document.addEventListener('input', (e) => {
    const el = e.target.closest('[data-on-input]');
    if (el && inputs[el.dataset.onInput]) inputs[el.dataset.onInput](el, e);
  });

  document.addEventListener('change', (e) => {
    if (e.target.dataset.actChange === 'restore' && e.target.files[0]) more.restoreFile(e.target.files[0]);
  });

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
  window.addEventListener('hashchange', () => { closeSheet(); render(); });
}

async function start() {
  try {
    await load();
  } catch (err) {
    document.getElementById('app').innerHTML = `<div class="empty"><b>Kopor could not open its storage</b>${esc(err.message)}. Try a normal (not private) browser window.</div>`;
    return;
  }
  setCurrency(S.settings.currency);
  more.applyTheme();
  more.lockState.locked = !!S.settings.pinHash;
  wireEvents();
  initChartTips();
  render();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker not registered', err));
  }
  navigator.storage?.persist?.();
}
start();
