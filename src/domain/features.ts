// Which extra screens a business sees in More. Everyone gets the everyday tools; a few specialised ones appear only
// for the kinds of business that use them (or once they are in use), so the menu stays short. "Show all features"
// (Settings, kept on this phone) brings everything back, and hidden ones stay reachable from "More features".
import type { Book } from './book';

export type Extra = 'agent' | 'groups' | 'gst' | 'staff';
export const EXTRAS: Extra[] = ['agent', 'groups', 'gst', 'staff'];

/** Kinds of business that run savings or osusu groups as part of what they do: groups come first for them. */
const GROUP_TYPES = new Set(['association', 'church', 'school']);
export const groupsFirst = (book: Pick<Book, 'org'>) => GROUP_TYPES.has(book.org.type);

/** Whether this business would normally see the extra screen. */
export function extraOn(book: Pick<Book, 'org' | 'agentMoves' | 'groups' | 'members' | 'staffTerms'>, f: Extra): boolean {
  switch (f) {
    case 'agent': return book.org.type === 'agent' || book.agentMoves.some((m) => !m.deleted);
    case 'groups': return GROUP_TYPES.has(book.org.type) || book.org.type === 'personal' || book.groups.some((g) => !g.deleted);
    case 'gst': return !!book.org.tax_id?.trim() || (book.org.tax_rate ?? 0) > 0;
    case 'staff': return book.members.filter((m) => m.active).length > 1 || book.staffTerms.length > 0;
  }
}

const KEY = 'kopor.showAllFeatures';
export const showAllFeatures = (): boolean => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
export const setShowAllFeatures = (on: boolean) => { try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch { /* private mode */ } };
