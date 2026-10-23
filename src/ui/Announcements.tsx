// Messages from Kopor (Owner dashboard → News) at the top of Home: new features, outages, tips.
// Read straight from the announcements table (only live ones are visible); each can be closed on this phone.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getSupabase } from '@/cloud/supabase';
import { Icon } from './Icon';

interface Note { id: string; message: string; level: 'info' | 'warn' }
const KEY = 'kopor.closedNews';
const closed = (): string[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; } };

export function Announcements() {
  const { t } = useTranslation();
  const [notes, setNotes] = useState<Note[]>([]);
  useEffect(() => {
    let live = true;
    if (!navigator.onLine) return;
    getSupabase().then((sb) => sb?.from('announcements').select('id, message, level').order('created_at', { ascending: false }).limit(3))
      .then((r) => { if (live && r?.data) setNotes((r.data as Note[]).filter((n) => !closed().includes(n.id))); })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  const close = (id: string) => {
    setNotes(notes.filter((n) => n.id !== id));
    try { localStorage.setItem(KEY, JSON.stringify([...closed(), id].slice(-50))); } catch { /* private mode: closes until reload */ }
  };
  return notes.map((n) => (
    <div key={n.id} className={`alert ${n.level === 'warn' ? '' : 'info'}`} role="status" data-testid="announcement">
      <Icon name={n.level === 'warn' ? 'alert' : 'spark'} />
      <div style={{ flex: 1, whiteSpace: 'pre-line' }}>{n.message}</div>
      <button type="button" className="icon-btn" onClick={() => close(n.id)} aria-label={t('common.close')}><Icon name="x" size={18} /></button>
    </div>
  ));
}
