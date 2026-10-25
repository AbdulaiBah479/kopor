// Read text aloud with the phone's own voice (free, offline once the phone has a voice installed). The Android app uses
// the system text-to-speech; browsers use the Web Speech API. Krio has no voice of its own, so an English voice reads it
// (Krio written in its standard spelling sounds close).
const isNative = () => !!(globalThis as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
const voiceLang = (lang: string) => (lang === 'fr' ? 'fr-FR' : 'en-GB');

export function canSpeak(): boolean {
  return isNative() || typeof globalThis.speechSynthesis !== 'undefined';
}

export async function speak(text: string, lang = 'en'): Promise<void> {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return;
  try {
    if (isNative()) {
      const { TextToSpeech } = await import('@capacitor-community/text-to-speech');
      await TextToSpeech.stop().catch(() => {});
      await TextToSpeech.speak({ text: clean, lang: voiceLang(lang), rate: 0.9 });
      return;
    }
    const synth = globalThis.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = voiceLang(lang);
    u.rate = 0.9;
    synth.speak(u);
  } catch { /* no voice on this phone: stay silent */ }
}

export function stopSpeaking() {
  if (isNative()) import('@capacitor-community/text-to-speech').then(({ TextToSpeech }) => TextToSpeech.stop()).catch(() => {});
  else globalThis.speechSynthesis?.cancel();
}

/** Money said the way people say it: "Le 1,500" -> "1,500 Leones". */
export const sayMoney = (formatted: string) => `${formatted.replace(/^\s*(Le|SLE|NLe)\s*/i, '').trim()} Leones`;
