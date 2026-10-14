// Voice input that works in every modern browser and the Android app: record with MediaRecorder, then transcribe with
// Whisper through the Kopor cloud. The browser's built-in speech recognition is only a fallback,
// because many browsers (Firefox, Samsung Internet, in-app browsers, Android WebView) do not have it.
import { getSupabase } from '@/cloud/supabase';

export const canRecord = () => typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

type SR = { lang: string; interimResults: boolean; continuous: boolean; start: () => void; stop: () => void; abort: () => void;
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onerror: (e: { error: string }) => void; onend: () => void };
const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
export const BrowserSpeech = w.SpeechRecognition ?? w.webkitSpeechRecognition;

/** Errors mapped to translation keys the screen can show. */
export class VoiceError extends Error {}
export function voiceErrorKey(e: unknown): string {
  const name = (e as { name?: string })?.name ?? '';
  const msg = e instanceof Error ? e.message : String(e);
  if (name === 'NotAllowedError' || name === 'SecurityError' || msg === 'not-allowed' || msg === 'service-not-allowed') return 'voice.denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || msg === 'audio-capture') return 'voice.noMic';
  if (name === 'NotReadableError') return 'voice.busyMic';
  if (msg === 'voice.tooShort' || msg === 'no-speech') return 'voice.tooShort';
  if (!navigator.onLine || /network|fetch|offline/i.test(msg)) return 'voice.needNet';
  return 'voice.failed';
}

const MIME = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/aac'];
const extFor = (mime: string) => (mime.includes('mp4') || mime.includes('aac') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm');

export interface Recording { stop: () => Promise<Blob>; cancel: () => void }

/** Start recording. onLevel gets 0..1 about 20 times a second (for the "I can hear you" animation). */
export async function startRecording(onLevel?: (v: number) => void, maxSeconds = 45, onAutoStop?: () => void): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const mimeType = MIME.find((m) => MediaRecorder.isTypeSupported?.(m));
  const rec = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 32_000 } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

  // Level meter (optional: some browsers block AudioContext until a tap, which we already have).
  let ctx: AudioContext | null = null, raf = 0;
  try {
    ctx = new AudioContext();
    const an = ctx.createAnalyser(); an.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.fftSize);
    const tick = () => { an.getByteTimeDomainData(buf); let s = 0; for (const x of buf) s += ((x - 128) / 128) ** 2; onLevel?.(Math.min(1, Math.sqrt(s / buf.length) * 4)); raf = requestAnimationFrame(tick); };
    tick();
  } catch { /* level meter is decoration only */ }

  const release = () => { cancelAnimationFrame(raf); ctx?.close().catch(() => {}); stream.getTracks().forEach((t) => t.stop()); };
  const timer = setTimeout(() => onAutoStop?.(), maxSeconds * 1000);
  const started = Date.now();
  rec.start(250);

  return {
    stop: () => new Promise<Blob>((resolve, reject) => {
      clearTimeout(timer);
      rec.onstop = () => {
        release();
        const blob = new Blob(chunks, { type: rec.mimeType || mimeType || 'audio/webm' });
        if (Date.now() - started < 700 || blob.size < 2000) reject(new VoiceError('voice.tooShort')); else resolve(blob);
      };
      if (rec.state !== 'inactive') rec.stop(); else rec.onstop(new Event('stop'));
    }),
    cancel: () => { clearTimeout(timer); try { rec.stop(); } catch { /* already stopped */ } release(); },
  };
}

/** Turn a recording into text with the Kopor cloud (Whisper on the providers the owner chose). */
export async function transcribe(blob: Blob, lang: string): Promise<string> {
  const file = new File([blob], `speech.${extFor(blob.type)}`, { type: blob.type || 'audio/webm' });
  const sb = await getSupabase();
  if (!sb) throw new Error('voice.needCloud');
  const form = new FormData();
  form.append('file', file); form.append('lang', lang);
  const { data, error } = await sb.functions.invoke('ai', { body: form });
  if (error) {
    const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error(body?.error ?? error.message);
  }
  return String(data?.text ?? '').trim();
}
