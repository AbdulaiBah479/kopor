// Live staff location during working hours (Staff & attendance → Today). The owner switches it on; each person is
// told and agrees on their own phone before anything is shared; sharing stops when they tap out. Owners and
// managers see where everyone who is at work is now, how far from the shop, how exact, and today's route.
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp, useBook } from '@/state/app';
import { useOverlay } from '@/ui/overlay';
import { Icon } from '@/ui/Icon';
import { updateOrg } from '@/domain/org';
import { distanceM, type Point } from '@/lib/geo';
import { addDays, today } from '@/lib/dates';
import { livePositions, routeToday, type LivePos } from '@/cloud/live';
import { hasLiveConsent, setLiveConsent, stopLiveSharing, syncLiveSharing, useLiveState } from '@/features/liveShare';
import type { Member } from '@/db/schema';

const STALE_MIN = 10; // no position for this long while at work: the phone is off, offline or location is off

/** Owner: switch live location on or off for the business. */
export function LiveSwitch() {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx } = useApp();
  const { toast, fail } = useOverlay();
  return (
    <div className="stack" style={{ width: '100%' }}>
      <label className="check"><input type="checkbox" data-testid="live-switch" checked={!!book.org.track_live}
        onChange={(e) => updateOrg(ctx, { track_live: e.target.checked ? 1 : 0 }).then(() => toast(t('common.saved'))).catch(fail)} /> {t('live.switch')}</label>
      <div className="small muted">{t('live.switchHelp')}</div>
    </div>
  );
}

/** On each person's own phone: agree (or not) to share while at work, and see whether it is being shared now. */
export function LiveConsent({ me, working }: { me: Member; working: boolean }) {
  const { t } = useTranslation();
  const book = useBook();
  const state = useLiveState();
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => { hasLiveConsent(book.org.id, me.id).then(setOk); }, [book.org.id, me.id]);
  const apply = useCallback(async (agree: boolean) => {
    await setLiveConsent(book.org.id, me.id, agree);
    setOk(agree);
    if (!agree) { stopLiveSharing(); return; }
    await syncLiveSharing({ orgId: book.org.id, memberId: me.id, working, enabled: true,
      title: t('live.notifTitle'), body: t('live.notifBody', { name: book.org.name }) });
  }, [book.org.id, book.org.name, me.id, working, t]);
  if (!book.org.track_live || ok === null) return null;
  if (!ok) return (
    <div className="alert info" data-testid="live-consent" style={{ flexDirection: 'column' }}>
      <div><b>{t('live.askTitle')}</b></div>
      <div className="small">{t('live.askBody', { name: book.org.name })}</div>
      <div className="btn-row">
        <button className="btn primary sm" data-testid="live-agree" onClick={() => apply(true)}>{t('live.agree')}</button>
        <button className="btn ghost sm" onClick={() => apply(false).then(() => setOk(false))}>{t('live.notNow')}</button>
      </div>
    </div>
  );
  return (
    <div className="small muted row between" data-testid="live-status" style={{ flexWrap: 'wrap', gap: 8 }}>
      <span><Icon name="pin" size={14} className="mr-0.5 inline" />{t(working ? `live.state.${state}` : 'live.state.notWorking')}</span>
      <button className="btn ghost sm" onClick={() => apply(false)}>{t('live.stop')}</button>
    </div>
  );
}

const ago = (iso: string, nowMs: number) => Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 60_000));
const mapLink = (p: Point) => `https://www.google.com/maps/search/?api=1&query=${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
const NICE = [50, 100, 200, 500, 1000, 2000, 5000, 10_000, 20_000, 50_000, 100_000, 500_000];

/** Positions drawn to scale around the shop (north is up). Distances use the same flat-earth maths as a street map. */
function Radar({ centre, dots, path, radiusM, label }: { centre: Point; dots: { id: string; p: Point; tone: string; text: string }[]; path?: Point[]; radiusM: number; label: string }) {
  const k = Math.cos((centre.lat * Math.PI) / 180);
  const xy = (p: Point) => [(p.lng - centre.lng) * 111_320 * k, (p.lat - centre.lat) * 110_540] as const;
  const far = Math.max(radiusM, ...dots.map((d) => Math.hypot(...xy(d.p))), ...(path ?? []).map((p) => Math.hypot(...xy(p))));
  const scale = NICE.find((n) => n >= far * 1.1) ?? far * 1.2;
  const S = 140, px = (m: number) => (m / scale) * S;
  const pt = (p: Point) => { const [x, y] = xy(p); return [S + px(x), S - px(y)] as const; };
  return (
    <svg viewBox={`0 0 ${S * 2} ${S * 2}`} role="img" aria-label={label} style={{ width: '100%', maxWidth: 360, margin: '0 auto', display: 'block' }}>
      <circle cx={S} cy={S} r={S - 1} fill="var(--elevated)" stroke="var(--separator)" />
      <circle cx={S} cy={S} r={S / 2} fill="none" stroke="var(--separator)" strokeDasharray="2 4" />
      <circle cx={S} cy={S} r={Math.min(px(radiusM), S - 1)} fill="var(--primary-soft)" stroke="var(--primary)" strokeDasharray="4 3" />
      <text x={S + 4} y={S - S / 2 - 4} fontSize="10" fill="var(--muted-foreground)">{scale / 2 >= 1000 ? `${scale / 2000} km` : `${scale / 2} m`}</text>
      <text x={S + 4} y={12} fontSize="10" fill="var(--muted-foreground)">{scale >= 1000 ? `${scale / 1000} km` : `${scale} m`}</text>
      <text x={S} y={S * 2 - 6} fontSize="10" textAnchor="middle" fill="var(--muted-foreground)">N ↑</text>
      <rect x={S - 5} y={S - 5} width={10} height={10} rx={2} fill="var(--foreground)" />
      {path && path.length > 1 && <polyline points={path.map((p) => pt(p).join(',')).join(' ')} fill="none" stroke="var(--primary)" strokeWidth={2} strokeLinejoin="round" />}
      {dots.map((d) => { const [x, y] = pt(d.p); return (
        <g key={d.id}>
          <circle cx={x} cy={y} r={9} fill={d.tone} stroke="var(--background)" strokeWidth={2} />
          <text x={x} y={y + 3.5} fontSize="9" fontWeight="700" textAnchor="middle" fill="#fff">{d.text}</text>
        </g>
      ); })}
    </svg>
  );
}

function RouteSheet({ member, shop, radiusM }: { member: Member; shop: Point | null; radiusM: number }) {
  const { t } = useTranslation();
  const book = useBook();
  const [route, setRoute] = useState<LivePos[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { routeToday(book.org.id, member.id).then(setRoute).catch((e) => setErr(t(e.message, { defaultValue: t('live.loadFailed') }))); }, [book.org.id, member.id, t]);
  if (err) return <div className="small muted">{err}</div>;
  if (!route) return <div className="small muted">{t('common.loading')}</div>;
  if (!route.length) return <div className="small muted">{t('live.noRoute')}</div>;
  let walked = 0;
  for (let i = 1; i < route.length; i++) walked += distanceM(route[i - 1], route[i]);
  const away = shop ? route.filter((p) => distanceM(p, shop) - p.accuracy > radiusM).length : 0;
  const last = route[route.length - 1];
  return (
    <div className="stack" data-testid="live-route">
      <Radar centre={shop ?? route[0]} dots={[{ id: 'now', p: last, tone: 'var(--primary)', text: member.name[0]?.toUpperCase() ?? '?' }]} path={route} radiusM={radiusM} label={t('live.routeOf', { name: member.name })} />
      <div className="small">{t('live.routeSummary', { n: route.length, from: route[0].at.slice(11, 16), to: last.at.slice(11, 16), km: (walked / 1000).toFixed(1) })}</div>
      {shop && <div className="small">{t('live.awayCount', { n: away, total: route.length })}</div>}
      {route.some((p) => p.fake) && <div className="alert bad small">{t('live.fake')}</div>}
    </div>
  );
}

/** Owners and managers: everyone at work now, live. Refreshes every 30 seconds while open. */
export function LiveMap() {
  const { t } = useTranslation();
  const book = useBook();
  const { openSheet } = useOverlay();
  const [pos, setPos] = useState<LivePos[] | null>(null);
  const [err, setErr] = useState('');
  const [nowMs, setNow] = useState(() => Date.now());
  useEffect(() => {
    let live = true;
    const load = () => livePositions(book.org.id).then((p) => { if (live) { setPos(p); setErr(''); setNow(Date.now()); } })
      .catch((e) => { if (live) setErr(t(e.message, { defaultValue: t('live.loadFailed') })); });
    void load();
    const id = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 30_000);
    return () => { live = false; clearInterval(id); };
  }, [book.org.id, t]);
  if (!book.org.track_live) return null;
  const shop = book.org.shop_lat != null && book.org.shop_lng != null ? { lat: book.org.shop_lat, lng: book.org.shop_lng } : null;
  const radius = book.org.away_m || 200;
  const yday = addDays(today(), -1);
  const atWork = book.members.filter((m) => m.active && !m.deleted && book.attendance.some((a) => a.member_id === m.id && !a.deleted && a.time_in && !a.time_out && a.date >= yday));
  const byId = new Map((pos ?? []).map((p) => [p.member_id, p]));
  const rows = atWork.map((m) => {
    const p = byId.get(m.id);
    const fresh = p && new Date(p.at).getTime() > nowMs - 12 * 3600_000 ? p : undefined;
    const d = fresh && shop ? Math.max(0, distanceM(fresh, shop) - Math.round(fresh.accuracy)) : null;
    const stale = fresh ? ago(fresh.at, nowMs) >= STALE_MIN : true;
    const tone = !fresh ? 'var(--muted-foreground)' : fresh.fake ? 'var(--danger)' : d != null && d > radius ? 'var(--warning)' : 'var(--primary)';
    return { m, p: fresh, d, stale, tone };
  });
  const centre = shop ?? rows.find((r) => r.p)?.p ?? null;
  return (
    <div className="card stack" data-testid="live-map">
      <div className="row between"><b><Icon name="pin" size={18} className="mr-1 inline" />{t('live.title')}</b><span className="small muted">{t('live.refresh')}</span></div>
      {err && <div className="small muted">{err}</div>}
      {!atWork.length ? <div className="small muted">{t('live.nobody')}</div> : <>
        {centre && rows.some((r) => r.p) && (
          <Radar centre={centre} radiusM={radius} label={t('live.title')}
            dots={rows.filter((r) => r.p).map((r) => ({ id: r.m.id, p: r.p!, tone: r.tone, text: r.m.name[0]?.toUpperCase() ?? '?' }))} />
        )}
        <div className="list">
          {rows.map(({ m, p, d, stale }) => (
            <div key={m.id} className="item" data-member={m.name} style={{ flexWrap: 'wrap' }}>
              <div className="main">
                <div className="t with-badge"><span className="trunc">{m.name}</span>
                  {!p ? <span className="badge">{t('live.noSignal')}</span>
                    : p.fake ? <span className="badge bad">{t('live.fakeBadge')}</span>
                    : d != null && d > radius ? <span className="badge warn">{t('live.awayM', { m: d })}</span>
                    : d != null ? <span className="badge good">{t('staff.atShop')}</span> : null}</div>
                <div className="s">{p ? `${t('live.seen', { min: ago(p.at, nowMs) })} · ±${Math.round(p.accuracy)} m` : t('live.notShared')}
                  {p && stale ? ` · ${t('live.stale')}` : ''}</div>
              </div>
              {p && <div className="btn-row" style={{ width: '100%' }}>
                <a className="btn sm" href={mapLink(p)} target="_blank" rel="noopener noreferrer"><Icon name="pin" size={16} /> {t('live.openMap')}</a>
                <button className="btn ghost sm" onClick={() => openSheet(t('live.routeOf', { name: m.name }), <RouteSheet member={m} shop={shop} radiusM={radius} />)}>{t('live.route')}</button>
              </div>}
            </div>
          ))}
        </div>
      </>}
      <div className="small muted">{t('live.privacy')}</div>
    </div>
  );
}
