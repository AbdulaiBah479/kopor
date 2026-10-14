// Bottom sheets and toasts, available anywhere through useOverlay().
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { Icon } from './Icon';
import { AppError } from '@/domain/book';
import { PermissionError } from '@/db/permissions';
import { reportError } from '@/features/monitoring';

interface SheetState { title: string; body: ReactNode }
interface Overlay {
  openSheet: (title: string, body: ReactNode) => void;
  closeSheet: () => void;
  toast: (msg: string) => void;
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
    return /^errx?\./.test(msg) ? t(msg) : msg || t('err.generic');
  };
}

export function OverlayProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const errText = useErrorText();
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [toastMsg, setToast] = useState('');
  const timer = useRef<number>();
  const sheetRef = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<Element | null>(null);

  const closeSheet = useCallback(() => {
    setSheet(null);
    (lastFocus.current as HTMLElement | null)?.focus?.();
  }, []);
  const openSheet = useCallback((title: string, body: ReactNode) => { lastFocus.current = document.activeElement; setSheet({ title, body }); }, []);
  const toast = useCallback((m: string) => {
    setToast(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(''), 2800);
  }, []);
  const fail = useCallback((e: unknown) => {
    console.error(e);
    // Expected problems (validation, permissions) are not bugs; report only unexpected errors.
    if (!(e instanceof AppError) && !(e instanceof PermissionError) && !(e instanceof Error && /^errx?\./.test(e.message))) reportError(e);
    toast(errText(e));
  }, [toast, errText]);

  // Navigating (including the phone's back button) closes any open sheet.
  const { pathname } = useLocation();
  useEffect(() => { setSheet(null); }, [pathname]);

  useEffect(() => {
    if (!sheet) return;
    const el = sheetRef.current;
    const first = el?.querySelector<HTMLElement>('[autofocus], input, select, textarea, button:not([data-close])');
    // Focus the first field, unless the user is already typing inside the sheet.
    setTimeout(() => { if (!el?.contains(document.activeElement)) first?.focus(); }, 50);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSheet();
      if (e.key === 'Tab' && el) { // keep keyboard focus inside the dialog
        const f = [...el.querySelectorAll<HTMLElement>('button, a, input, select, textarea')].filter((x) => !x.hasAttribute('disabled'));
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sheet, closeSheet]);

  return (
    <Ctx.Provider value={{ openSheet, closeSheet, toast, fail }}>
      {children}
      {sheet && (
        <div id="sheet-root" className="open">
          <div className="sheet-backdrop" onClick={closeSheet} />
          <div className="sheet" role="dialog" aria-modal="true" aria-label={sheet.title} ref={sheetRef}>
            <div className="sheet-head">
              <h2>{sheet.title}</h2>
              <button type="button" className="icon-btn" data-close onClick={closeSheet} aria-label={t('common.close')}><Icon name="x" /></button>
            </div>
            <div className="sheet-body">{sheet.body}</div>
          </div>
        </div>
      )}
      <div id="toast" className={toastMsg ? 'show' : ''} role="status" aria-live="polite">{toastMsg}</div>
    </Ctx.Provider>
  );
}
