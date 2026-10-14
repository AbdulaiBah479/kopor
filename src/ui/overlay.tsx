// Bottom sheets (vaul: draggable, swipe down to close) and toasts (sonner: stackable, with Undo).
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { Drawer } from 'vaul';
import { Toaster, toast as sonner } from 'sonner';
import { Icon } from './Icon';
import { AppError } from '@/domain/book';
import { PermissionError } from '@/db/permissions';
import { reportError } from '@/features/monitoring';

interface SheetState { title: string; body: ReactNode; key: number }
export interface ToastOpts { undo?: () => Promise<unknown> | unknown; tone?: 'success' | 'error' | 'info' }
interface Overlay {
  openSheet: (title: string, body: ReactNode) => void;
  closeSheet: () => void;
  toast: (msg: string, opts?: ToastOpts) => void;
  fail: (e: unknown) => void;
}
const Ctx = createContext<Overlay | null>(null);
export const useOverlay = () => useContext(Ctx)!;

/** Translate any thrown error into a user-friendly message. */
export function useErrorText() {
  const { t } = useTranslation();
  return (e: unknown) => {
    if (e instanceof AppError) return t(e.key, e.params);
    if (e instanceof PermissionError) return t('err.permission');
    const msg = e instanceof Error ? e.message : String(e);
    // Dropped connections are common: say so plainly instead of showing a technical message.
    if (/failed to fetch|networkerror|load failed|network request failed|err_name_not_resolved|timeout/i.test(msg) || !navigator.onLine) return t('errx.offline');
    return /^errx?\./.test(msg) ? t(msg) : msg || t('err.generic');
  };
}

/** Short vibration on supported phones: confirms an action without looking. */
export const haptic = (ms = 12) => { try { navigator.vibrate?.(ms); } catch { /* not supported */ } };

export function OverlayProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const errText = useErrorText();
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [open, setOpen] = useState(false);

  const closeSheet = useCallback(() => setOpen(false), []);
  const openSheet = useCallback((title: string, body: ReactNode) => { setSheet({ title, body, key: Date.now() }); setOpen(true); }, []);
  const toast = useCallback((m: string, opts: ToastOpts = {}) => {
    if (opts.tone !== 'error') haptic();
    const action = opts.undo ? { label: t('common.undo'), onClick: () => { Promise.resolve(opts.undo!()).then(() => sonner(t('common.undone'))); } } : undefined;
    if (opts.tone === 'error') sonner.error(m); else sonner.success(m, { action, duration: opts.undo ? 6000 : 2800 });
  }, [t]);
  const fail = useCallback((e: unknown) => {
    console.error(e);
    // Expected problems (validation, permissions) are not bugs; report only unexpected errors.
    if (!(e instanceof AppError) && !(e instanceof PermissionError) && !(e instanceof Error && /^errx?\./.test(e.message))) reportError(e);
    haptic(40);
    toast(errText(e), { tone: 'error' });
  }, [toast, errText]);

  // Navigating (including the phone's back button) closes any open sheet.
  const { pathname } = useLocation();
  const [shownPath, setShownPath] = useState(pathname);
  if (shownPath !== pathname) { setShownPath(pathname); setOpen(false); }

  return (
    <Ctx.Provider value={{ openSheet, closeSheet, toast, fail }}>
      {children}
      <Drawer.Root open={open} onOpenChange={setOpen} repositionInputs>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-40 bg-black/45" />
          <Drawer.Content
            key={sheet?.key}
            className="sheet fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[94dvh] max-w-[600px] flex-col rounded-t-[14px] bg-background outline-none"
            onOpenAutoFocus={(e) => {
              // Focus the first field (e.g. the amount) instead of the close button.
              e.preventDefault();
              const el = (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>('[autofocus], input:not([type=hidden]):not([type=file]), select, textarea');
              el?.focus();
            }}>
            <div className="mx-auto mt-2 h-[5px] w-9 shrink-0 rounded-full bg-[var(--fill-strong)]" aria-hidden="true" />
            {/* iOS sheet header: centred title, round grey close button */}
            <div className="relative flex min-h-12 items-center justify-center px-14 pb-1 pt-2">
              <Drawer.Title className="m-0 truncate text-[17px] font-semibold">{sheet?.title}</Drawer.Title>
              <Drawer.Description className="sr-only">{sheet?.title}</Drawer.Description>
              <button type="button" onClick={closeSheet} aria-label={t('common.close')}
                className="absolute right-4 top-2 grid size-[30px] place-items-center rounded-full bg-[var(--fill)] text-muted-foreground active:scale-90">
                <Icon name="x" size={16} strokeWidth={2.6} />
              </button>
            </div>
            <div className="sheet-body overflow-y-auto px-4 pb-[calc(20px+env(safe-area-inset-bottom))]" data-vaul-no-drag>{sheet?.body}</div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
      <Toaster position="top-center" richColors closeButton theme={document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'}
        toastOptions={{ style: { fontFamily: 'inherit', borderRadius: 18, fontSize: 15, backdropFilter: 'blur(20px)' } }} offset={{ top: 'calc(12px + env(safe-area-inset-top))' }} />
    </Ctx.Provider>
  );
}
