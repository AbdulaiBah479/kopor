import { describe, it, expect } from 'vitest';
import { dialectOf, lookup, languageNote, withLanguageHelp } from '../../supabase/functions/_shared/lang';

describe('Krio and Nigerian Pidgin help for the AI', () => {
  it('tells Krio, Pidgin and English apart', () => {
    expect(dialectOf('Fatu tek 2 tin ɔyl pan trɔs')).toBe('kri');
    expect(dialectOf('Mohamed don pe tri tawzin')).toBe('kri');
    expect(dialectOf('a dɔn sɛl tu bag rɛs tide')).toBe('kri');
    expect(dialectOf('Chidi dey owe me 2000')).toBe('pcm');
    expect(dialectOf('Abeg, how much una sell am?')).toBe('pcm');
    expect(dialectOf('Sold two bags of rice for 1700')).toBeNull();
    expect(dialectOf('Fatu took 2 tins of oil on credit')).toBeNull();
  });

  it('finds the matching words, including typed without ɛ and ɔ', () => {
    const kri = lookup('Aminata tek oyl pan tros', 'kri').map((e) => e.en).join(' | ');
    expect(kri).toMatch(/credit/);
    expect(kri).toMatch(/oil/);
    const pcm = lookup('Emeka never pay, e dey owe me', 'pcm').map((e) => e.en).join(' | ');
    expect(pcm).toMatch(/owe/);
    expect(pcm).toMatch(/not paid/);
  });

  it('adds a short note to the instructions only for Krio or Pidgin', () => {
    const note = languageNote('Wetin a sɛl tide?');
    expect(note).toMatch(/Sierra Leone Krio/);
    expect(note.length).toBeLessThan(2200);
    expect(languageNote('What did I sell today?')).toBe('');

    const msgs = [{ role: 'system', content: 'You are Kopor.' }, { role: 'user', content: 'Abeg, wetin I sell today?' }];
    const out = withLanguageHelp(msgs);
    expect(out[0].content).toMatch(/^You are Kopor\.\n\nLanguage help: .*Nigerian Pidgin/s);
    expect(out[1]).toBe(msgs[1]);
    const english = [{ role: 'system', content: 'You are Kopor.' }, { role: 'user', content: 'What did I sell today?' }];
    expect(withLanguageHelp(english)).toBe(english);
  });

  it('reads text inside picture messages too', () => {
    const msgs = [{ role: 'user', content: [{ type: 'text', text: 'Fatu dɔn pe 300 tide' }, { type: 'image_url' }] }];
    const out = withLanguageHelp(msgs);
    expect(out).toHaveLength(2);
    expect(out[0].role).toBe('system');
  });
});
