// Global app state: device settings, current business/member session, live data (Book),
// permissions, auto-lock and background cloud sync.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import i18n, { setLanguage } from '@/i18n';
import { db, type Member, type Role } from '@/db/schema';
import { getMeta, setMeta, type Ctx } from '@/db/repo';
import { can as canRole, type Perm } from '@/db/permissions';
import { loadBook, type Book } from '@/domain/book';
import { getSession, setSession, anyPin, type Session } from '@/domain/org';
import { setCurrencySymbol } from '@/lib/money';
import { setDataSaver } from '@/lib/image';
import { addDays, today } from '@/lib/dates';
import { syncNow, onSyncState, type SyncState } from '@/cloud/sync';

export type Accent = 'emerald' | 'ocean' | 'royal' | 'sunset' | 'rose' | 'graphite';
export type TextSize = 'normal' | 'large' | 'xl';
export interface Appearance { theme: 'auto' | 'light' | 'dark'; accent: Accent; text: TextSize }
/** simple: picture and voice mode on Home; voice: read things aloud. */
// hideMoney blurs amounts (for counting in front of customers); closeHour = when "Close the day" rings (0 = never);
// dataSaver sends smaller photos to the AI.
export interface DeviceSettings extends Appearance { lang: string; autoLockMin: number; simple: boolean; voice: boolean; hideMoney: boolean; closeHour: number; dataSaver: boolean }
const DEVICE_DEFAULTS: DeviceSettings = { lang: 'en', theme: 'auto', accent: 'emerald', text: 'normal', autoLockMin: 5, simple: false, voice: true, hideMoney: false, closeHour: 19, dataSaver: false };

function applyDevicePrivacy(d: DeviceSettings) {
  if (d.hideMoney) document.documentElement.dataset.hide = ''; else delete document.documentElement.dataset.hide;
  setDataSaver(d.dataSaver);
}

interface AppState {
  ready: boolean;
  device: DeviceSettings;
  setDevice: (p: Partial<DeviceSettings>) => Promise<void>;
  session: Session | null;
  switchSession: (s: Session | null) => Promise<void>;
  book: Book | null | undefined;
  member: Member | undefined;
  role: Role;
  ctx: Ctx;
  can: (p: Perm) => boolean;
  locked: boolean;
  lock: () => void;
  unlock: () => void;
  sync: SyncState;
  requestSync: () => void;
}

const AppCtx = createContext<AppState | null>(null);
export const useApp = () => useContext(AppCtx)!;
/** Book is guaranteed inside the main shell. */
export const useBook = () => useApp().book as Book;

// Appearance lives on <html>: data-theme (resolved light/dark; "auto" follows the phone live), data-accent, data-text.
// A copy is kept in localStorage so main.tsx can apply it before the first paint (no colour flash on start).
const darkQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
const APPEARANCE_KEY = 'kopor-appearance';
let current: Appearance = { theme: 'auto', accent: 'emerald', text: 'normal' };
const resolveTheme = () => {
  const root = document.documentElement;
  const dark = current.theme === 'dark' || (current.theme === 'auto' && !!darkQuery?.matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  if (current.accent === 'emerald') delete root.dataset.accent; else root.dataset.accent = current.accent;
  if (current.text === 'normal') delete root.dataset.text; else root.dataset.text = current.text;
  const bg = getComputedStyle(root).getPropertyValue('--background').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg || (dark ? '#000000' : '#f2f2f7'));
};
darkQuery?.addEventListener?.('change', resolveTheme);
export function applyAppearance(a: Partial<Appearance>) {
  current = { ...current, ...a };
  resolveTheme();
  try { localStorage.setItem(APPEARANCE_KEY, JSON.stringify(current)); } catch { /* private mode */ }
}
/** Apply the last saved appearance immediately at start-up. */
export function applySavedAppearance() {
  let saved: Partial<Appearance> = {};
  try { saved = JSON.parse(localStorage.getItem(APPEARANCE_KEY) ?? '{}'); } catch { /* none yet */ }
  current = { ...current, ...saved };
  resolveTheme();
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [device, setDeviceState] = useState(DEVICE_DEFAULTS);
  const [session, setSess] = useState<Session | null>(null);
  const [locked, setLocked] = useState(false);
  const [sync, setSync] = useState<SyncState>({ status: 'off', lastSync: null });

  useEffect(() => {
    (async () => {
      const d = { ...DEVICE_DEFAULTS, ...(await getMeta<Partial<DeviceSettings>>('device', {})) };
      setDeviceState(d);
      await setLanguage(d.lang);
      document.documentElement.lang = d.lang === 'kri' ? 'kri' : d.lang;
      applyAppearance({ theme: d.theme, accent: d.accent, text: d.text });
      applyDevicePrivacy(d);
      setSess(await getSession());
      setLocked(await anyPin());
      setReady(true);
    })();
    return onSyncState(setSync);
  }, []);

  const book = useLiveQuery(() => (session ? loadBook(session.orgId, session.branchId) : Promise.resolve(null)), [session?.orgId, session?.branchId]);
  // Android app: keep tomorrow's 8:00 reminder up to date with the records (a few seconds after any change).
  useEffect(() => {
    if (!book) return;
    const timer = window.setTimeout(() => {
      const role = book.members.find((m) => m.id === session?.memberId)?.role ?? 'viewer';
      import('@/features/dailyReminder').then((m) => m.scheduleDailyReminder(book, i18n.t, { owner: canRole(role, 'reports'), closes: canRole(role, 'close'), closeHour: device.closeHour })).catch(() => {});
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [book, session?.memberId, device.closeHour]);
  const me = book?.members.find((m) => m.id === session?.memberId);
  // Live location: share this phone's position while tapped in, if the owner switched it on and the person agreed.
  const myDay = book && me ? book.attendance.find((x) => x.member_id === me.id && !x.deleted && x.time_in && !x.time_out && x.date >= addDays(today(), -1)) : undefined;
  const liveOn = !!book?.org.track_live && !!me?.active && !!myDay;
  useEffect(() => {
    if (!book || !me) return;
    import('@/features/liveShare').then((m) => m.syncLiveSharing({
      orgId: book.org.id, memberId: me.id, working: liveOn, enabled: !!book.org.track_live,
      title: i18n.t('live.notifTitle'), body: i18n.t('live.notifBody', { name: book.org.name }),
    })).catch(() => {});
  }, [book?.org.id, me?.id, liveOn, book?.org.track_live]); // eslint-disable-line react-hooks/exhaustive-deps
  const member = me;
  const role: Role = member?.active ? member.role : 'viewer';
  // Owners and managers: watch for fraud alerts while Kopor is open (needs the cloud).
  const watching = !!book && canRole(role, 'reports') && sync.status !== 'off';
  const orgId = book?.org.id;
  useEffect(() => {
    if (!watching || !orgId) return;
    let stop: (() => void) | undefined;
    import('@/features/alertWatch').then((m) => { m.startAlertWatch(orgId, i18n.t); stop = m.stopAlertWatch; }).catch(() => {});
    return () => stop?.();
  }, [watching, orgId]);
  useEffect(() => {
    if (watching && orgId && sync.status === 'idle') import('@/features/alertWatch').then((m) => m.checkAlerts(orgId, i18n.t)).catch(() => {});
  }, [sync.lastSync]); // eslint-disable-line react-hooks/exhaustive-deps
  if (book) setCurrencySymbol(book.org.currency);

  const setDevice = useCallback(async (p: Partial<DeviceSettings>) => {
    const next = { ...device, ...p };
    setDeviceState(next);
    // Apply first so the change is instant; saving to the device database can follow.
    if (p.theme || p.accent || p.text) applyAppearance({ theme: next.theme, accent: next.accent, text: next.text });
    applyDevicePrivacy(next);
    if (p.lang) { document.documentElement.lang = p.lang; await setLanguage(p.lang); }
    await setMeta('device', next);
  }, [device]);

  const switchSession = useCallback(async (s: Session | null) => { await setSession(s); setSess(s); }, []);

  // Auto-lock after inactivity when any PIN is set on this device.
  const lastActive = useRef(0);
  useEffect(() => {
    lastActive.current = Date.now();
    const bump = () => { lastActive.current = Date.now(); };
    const events = ['pointerdown', 'keydown', 'scroll'];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const timer = window.setInterval(async () => {
      if (!locked && device.autoLockMin > 0 && Date.now() - lastActive.current > device.autoLockMin * 60_000 && (await anyPin())) setLocked(true);
    }, 15_000);
    return () => { events.forEach((e) => window.removeEventListener(e, bump)); window.clearInterval(timer); };
  }, [locked, device.autoLockMin]);

  // Background sync: on start, every minute, when back online, and shortly after local changes.
  const syncTimer = useRef<number>();
  const requestSync = useCallback(() => {
    if (!session) return;
    window.clearTimeout(syncTimer.current);
    syncTimer.current = window.setTimeout(() => syncNow(session.orgId), 4000);
  }, [session]);
  useEffect(() => {
    if (!session) return;
    syncNow(session.orgId);
    const iv = window.setInterval(() => syncNow(session.orgId), 60_000);
    const online = () => syncNow(session.orgId);
    window.addEventListener('online', online);
    return () => { window.clearInterval(iv); window.removeEventListener('online', online); };
  }, [session]);
  useEffect(() => { if (book) requestSync(); }, [book, requestSync]);

  const ctx: Ctx = useMemo(() => ({
    orgId: session?.orgId ?? '', memberId: session?.memberId ?? null, memberName: member?.name ?? '', branchId: session?.branchId ?? null, role,
  }), [session, member?.name, role]);

  const value: AppState = {
    ready, device, setDevice, session, switchSession, book, member, role, ctx,
    can: (p) => canRole(role, p), locked, lock: () => setLocked(true), unlock: () => setLocked(false), sync, requestSync,
  };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

/** Businesses stored on this device (for the business switcher). */
export const useLocalOrgs = () => useLiveQuery(() => db.orgs.filter((o) => !o.deleted && !!o.name).toArray(), []) ?? [];
