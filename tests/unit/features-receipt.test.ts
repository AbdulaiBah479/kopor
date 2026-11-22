import { describe, expect, it } from 'vitest';
import { extraOn, groupsFirst } from '@/domain/features';
import { cleanCode, receiptCode, receiptLink } from '@/domain/receipt';
import { captureRef, inviteLink, storedRef, clearRef } from '@/lib/referral';
import type { Book } from '@/domain/book';

const book = (over: Partial<Book['org']> = {}, more: Partial<Book> = {}) =>
  ({ org: { type: 'shop', tax_id: '', tax_rate: 0, ...over }, agentMoves: [], groups: [], members: [{ active: true }], staffTerms: [], ...more }) as unknown as Book;

describe('menu by kind of business', () => {
  it('shows the agent book to agents, or once it is used', () => {
    expect(extraOn(book(), 'agent')).toBe(false);
    expect(extraOn(book({ type: 'agent' }), 'agent')).toBe(true);
    expect(extraOn(book({}, { agentMoves: [{ deleted: 0 }] as never }), 'agent')).toBe(true);
  });
  it('shows groups first to associations and churches, and to anyone running a group', () => {
    expect(groupsFirst(book({ type: 'church' }))).toBe(true);
    expect(extraOn(book(), 'groups')).toBe(false);
    expect(extraOn(book({ type: 'association' }), 'groups')).toBe(true);
    expect(extraOn(book({}, { groups: [{ deleted: 0 }] as never }), 'groups')).toBe(true);
  });
  it('shows GST once there is a tax number or rate, and Staff once there are staff', () => {
    expect(extraOn(book(), 'gst')).toBe(false);
    expect(extraOn(book({ tax_id: '123' }), 'gst')).toBe(true);
    expect(extraOn(book(), 'staff')).toBe(false);
    expect(extraOn(book({}, { members: [{ active: true }, { active: true }] as never }), 'staff')).toBe(true);
  });
});

describe('receipt codes', () => {
  const id = '3f2a9c1b-77d0-4e5f-8a9b-0c1d2e3f4a5b';
  it('are the first 12 characters of the sale id, in groups of four', () => {
    expect(receiptCode(id)).toBe('3F2A-9C1B-77D0');
    expect(cleanCode(' 3f2a 9c1b-77D0 ')).toBe('3f2a9c1b77d0');
    expect(cleanCode('3F2A-9C1B')).toBeNull();
    expect(receiptLink('https://x.app/kopor', id)).toBe('https://x.app/kopor/#/r/3F2A-9C1B-77D0');
  });
});

describe('invite links', () => {
  // The unit tests run without a browser: a tiny stand-in for this phone's storage.
  const mem = new Map<string, string>();
  globalThis.localStorage ??= { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) } as unknown as Storage;
  it('remember a valid code from the address, and ignore anything else', () => {
    clearRef();
    captureRef('#/?ref=abc234');
    expect(storedRef()).toBe('ABC234');
    clearRef();
    captureRef('#/?ref=<script>');
    expect(storedRef()).toBeNull();
    expect(inviteLink('https://x.app/kopor/', 'ABC234')).toBe('https://x.app/kopor/#/?ref=ABC234');
  });
});
