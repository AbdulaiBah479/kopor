// Built-in PDF fonts and thermal printers only cover Latin-1, so Krio letters are transliterated
// (ɛ→e, ɔ→o, ŋ→ng) and other unsupported characters (emoji) dropped.
export const latinSafe = (s: string) => s
  .replace(/ɛ/g, 'e').replace(/Ɛ/g, 'E').replace(/ɔ/g, 'o').replace(/Ɔ/g, 'O').replace(/ŋ/g, 'ng').replace(/Ŋ/g, 'Ng')
  .replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '');
