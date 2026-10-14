// Global app state: device settings, current business/member session, live data (Book),
// permissions, auto-lock and background cloud sync.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import i18n from '@/i18n';
import { db, type Member, type Role } from '@/db/schema';
import { getMeta, setMeta, type Ctx } from '@/db/repo';
import { can as canRole, type Perm } from '@/db/permissions';
import { loadBook, type Book } from '@/domain/book';
import { getSession, setSession, anyPin, type Session } from '@/domain/org';
import { setCurrencySymbol } from '@/lib/money';
import { syncNow, onSyncState, type SyncState } from '@/cloud/sync';

export interface DeviceSettings { lang: string; theme: 'auto' | 'light' | 'dark'; autoLockMin: number }
const DEVICE_DEFAULTS: DeviceSettings = { lang: 'en', theme: 'auto', autoLockMin: 5 };

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

export function applyTheme(theme: DeviceSettings['theme']) {
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
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
      await i18n.changeLanguage(d.lang);
      document.documentElement.lang = d.lang === 'kri' ? 'kri' : d.lang;
      applyTheme(d.theme);
      setSess(await getSession());
      setLocked(await anyPin());
      setReady(true);
    })();
    return onSyncState(setSync);
  }, []);

  const book = useLiveQuery(() => (session ? loadBook(session.orgId, session.branchId) : Promise.resolve(null)), [session?.orgId, session?.branchId]);
  const member = book?.members.find((m) => m.id === session?.memberId);
  const role: Role = member?.active ? member.role : 'viewer';
  if (book) setCurrencySymbol(book.org.currency);

  const setDevice = useCallback(async (p: Partial<DeviceSettings>) => {
    const next = { ...device, ...p };
    setDeviceState(next);
    await setMeta('device', next);
    if (p.lang) { await i18n.changeLanguage(p.lang); document.documentElement.lang = p.lang; }
    if (p.theme) applyTheme(p.theme);
  }, [device]);

  const switchSession = useCallback(async (s: Session | null) => { await setSession(s); setSess(s); }, []);

  // Auto-lock after inactivity when any PIN is set on this device.
  const lastActive = useRef(Date.now());
  useEffect(() => {
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
