// Free-tier AI with automatic fallback: each provider/model has its own free quota, so when one is rate-limited,
// down or retired, the next one answers. Providers are enabled simply by adding their key as a secret.
// (Free tiers listed in github.com/cheahjs/free-llm-api-resources.)

import { hasAmount, krioWords } from './amount.ts';

type Msg = { role: string; content: unknown };
interface Provider { name: string; base: string; key?: string; text: string[]; vision: string[]; extra?: (model: string) => Record<string, unknown> }

const list = (v: string | undefined, d: string[]) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : d);
const gptOss = (m: string) => (/gpt-oss/.test(m) ? { reasoning_effort: 'low' } : {});

function providers(): Provider[] {
  const e = (k: string) => Deno.env.get(k) || undefined;
  return [
    // Custom OpenAI-compatible endpoint first, if configured (e.g. a self-hosted model).
    { name: 'custom', base: e('AI_BASE_URL') ?? '', key: e('AI_API_KEY'), text: list(e('AI_MODEL'), []), vision: list(e('AI_VISION_MODEL'), []), extra: gptOss },
    // OmniRoute (github.com/diegosouzapw/OmniRoute, MIT): a self-hosted router in front of many free AI providers, with
    // its own fallback. OMNIROUTE_URL = its public address ending in /v1; OMNIROUTE_KEY = a key made in its dashboard;
    // OMNIROUTE_MODELS = the model or combo names to use (from its dashboard), comma-separated.
    { name: 'omniroute', base: e('OMNIROUTE_URL') ?? '', key: e('OMNIROUTE_KEY'),
      text: list(e('OMNIROUTE_MODELS'), []), vision: list(e('OMNIROUTE_VISION_MODELS'), []) },
    { name: 'groq', base: 'https://api.groq.com/openai/v1', key: e('GROQ_API_KEY'),
      text: list(e('GROQ_MODELS'), ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b']), vision: list(e('GROQ_VISION_MODELS'), ['qwen/qwen3.8-27b']), extra: gptOss },
    { name: 'gemini', base: 'https://generativelanguage.googleapis.com/v1beta/openai', key: e('GEMINI_API_KEY'),
      text: list(e('GEMINI_MODELS'), ['gemini-flash-latest', 'gemini-flash-lite-latest']), vision: list(e('GEMINI_MODELS'), ['gemini-flash-latest', 'gemini-flash-lite-latest']) },
    // Ollama: its free cloud (OLLAMA_API_KEY from ollama.com/settings/keys) or your own Ollama computer (OLLAMA_BASE_URL,
    // e.g. https://my-pc.example/v1; no key needed). Both speak the same OpenAI-style API.
    { name: 'ollama', base: e('OLLAMA_BASE_URL') ?? (e('OLLAMA_API_KEY') ? 'https://ollama.com/v1' : ''), key: e('OLLAMA_API_KEY') ?? (e('OLLAMA_BASE_URL') ? 'ollama' : undefined),
      // Models in Ollama's free cloud plan (tested 2026-10-30); gemma4 reads photos. gpt-oss is told to think briefly,
      // or its thinking can use up the whole answer.
      text: list(e('OLLAMA_MODELS'), ['gpt-oss:120b', 'gpt-oss:20b']), vision: list(e('OLLAMA_VISION_MODELS'), ['gemma4:31b']), extra: gptOss },
    { name: 'cerebras', base: 'https://api.cerebras.ai/v1', key: e('CEREBRAS_API_KEY'), text: list(e('CEREBRAS_MODELS'), ['gpt-oss-120b']), vision: [], extra: gptOss },
    { name: 'mistral', base: 'https://api.mistral.ai/v1', key: e('MISTRAL_API_KEY'),
      text: list(e('MISTRAL_MODELS'), ['mistral-small-latest']), vision: list(e('MISTRAL_VISION_MODELS'), ['mistral-small-latest']) },
    { name: 'github', base: 'https://models.github.ai/inference', key: e('GITHUB_MODELS_TOKEN'),
      text: list(e('GITHUB_MODELS'), ['openai/gpt-4.1-mini']), vision: list(e('GITHUB_MODELS'), ['openai/gpt-4.1-mini']) },
    { name: 'openrouter', base: 'https://openrouter.ai/api/v1', key: e('OPENROUTER_API_KEY'),
      text: list(e('OPENROUTER_MODELS'), ['openrouter/free']), vision: list(e('OPENROUTER_VISION_MODELS'), []) },
    { name: 'nvidia', base: 'https://integrate.api.nvidia.com/v1', key: e('NVIDIA_API_KEY'),
      text: list(e('NVIDIA_MODELS'), ['meta/llama-3.3-70b-instruct']), vision: list(e('NVIDIA_VISION_MODELS'), []) },
    { name: 'sambanova', base: 'https://api.sambanova.ai/v1', key: e('SAMBANOVA_API_KEY'),
      text: list(e('SAMBANOVA_MODELS'), ['Meta-Llama-3.3-70B-Instruct']), vision: list(e('SAMBANOVA_VISION_MODELS'), []) },
    { name: 'huggingface', base: 'https://router.huggingface.co/v1', key: e('HF_TOKEN'),
      text: list(e('HF_MODELS'), ['openai/gpt-oss-120b']), vision: list(e('HF_VISION_MODELS'), []) },
    { name: 'cloudflare', base: e('CLOUDFLARE_ACCOUNT_ID') ? `https://api.cloudflare.com/client/v4/accounts/${e('CLOUDFLARE_ACCOUNT_ID')}/ai/v1` : '', key: e('CLOUDFLARE_API_TOKEN'),
      text: list(e('CLOUDFLARE_MODELS'), ['@cf/meta/llama-3.3-70b-instruct-fp8-fast']), vision: list(e('CLOUDFLARE_VISION_MODELS'), []) },
  ].filter((p) => p.key && p.base);
}

// Remember rate-limited models for a while (per function instance) so we skip straight to one that works.
const cooldown = new Map<string, number>();

export interface LlmResult { content: string; provider: string; model: string }

export async function complete(messages: Msg[], opts: { vision?: boolean; maxTokens?: number } = {}): Promise<LlmResult> {
  const errors: string[] = [];
  // Photos (receipts, handwritten notes) go to Gemini first: it reads handwriting best. Others follow if it is busy.
  const ordered = opts.vision ? [...providers()].sort((a, b) => Number(b.name === 'gemini') - Number(a.name === 'gemini')) : providers();
  const chain = ordered.flatMap((p) => (opts.vision ? p.vision : p.text).map((model) => ({ p, model })));
  if (!chain.length) throw new Error('No AI provider configured (add GROQ_API_KEY or another free key)');
  // Models still cooling down go last rather than being dropped (better a retry than no answer).
  const now = Date.now();
  chain.sort((a, b) => Number((cooldown.get(`${a.p.name}/${a.model}`) ?? 0) > now) - Number((cooldown.get(`${b.p.name}/${b.model}`) ?? 0) > now));

  for (const { p, model } of chain) {
    const id = `${p.name}/${model}`;
    try {
      const res = await fetch(`${p.base.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.key}`, ...(p.name === 'openrouter' ? { 'HTTP-Referer': 'https://github.com/AbdulaiBah479/kopor', 'X-Title': 'Kopor' } : {}) },
        body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: opts.maxTokens ?? 1200, ...(p.extra?.(model) ?? {}) }),
        signal: AbortSignal.timeout(25_000),
      });
      if (res.status === 429 || res.status === 503) {
        const wait = Number(res.headers.get('retry-after')) || 60;
        cooldown.set(id, Date.now() + Math.min(wait, 3600) * 1000);
        errors.push(`${id}: busy`); continue;
      }
      if (!res.ok) { errors.push(`${id}: ${res.status}`); if (res.status === 404 || res.status === 400) cooldown.set(id, Date.now() + 6 * 3600_000); continue; }
      const j = await res.json();
      const content = j.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) { errors.push(`${id}: empty`); continue; }
      return { content, provider: p.name, model };
    } catch (e) {
      errors.push(`${id}: ${e instanceof Error ? e.name : 'error'}`);
      cooldown.set(id, Date.now() + 5 * 60_000); // unreachable or too slow: try the others first for a while
    }
  }
  console.error('All AI providers failed', errors);
  throw new Error('AI is busy right now. Kopor will use offline mode.');
}

/* Speech to text with Whisper (free on Groq; any OpenAI-compatible /audio/transcriptions endpoint works). */
// Plain letters only: special Krio letters (ɛ, ɔ) in the prompt make Whisper answer in phonetic symbols and drop
// numbers. Krio is written here the way people type it on phones.
const KRIO_PROMPT = 'Shop record in Sierra Leone, always with the amount in Leones. Sold 3 bags of rice for 2,500 Leones. ' +
  'Fatu took 2 tins of oil for 360 Leones on credit. Mohamed don pay 300 Leones. A sel tu bag res fo 1,700. Spent 200 Leones on transport.';

const b64 = (bytes: Uint8Array) => { let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(bin); };

/**
 * A second listener: Gemini hears the same recording. Whisper sometimes skips words; Gemini copes well with accents
 * and Krio. The app combines both versions (keeping only words that were really said). Null when not set up or busy.
 */
async function geminiListen(file: File, lang: string, hints: string): Promise<string | null> {
  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) return null;
  const data = b64(new Uint8Array(await file.arrayBuffer()));
  const text = `Write down exactly what is said in this short recording from a small shop in Sierra Leone (spoken in English or Krio${lang === 'fr' ? ', or French' : ''}). ` +
    'Write every word you hear, in the same language, including every quantity and amount of money (write numbers as digits). ' +
    'If Krio is spoken, write it in Krio the way people type it on phones (for example "Fatu tek 2 tin ɔyl pan trɔs", "A dɔn sɛl tu bag rɛs fɔ 1700", "Mohamed dɔn pe 300"); never translate Krio into English. ' +
    'Do not translate, summarise, correct, add or explain anything. Reply with the words only. If nothing is said, reply with nothing.' +
    (hints ? ` Customer and product names that may be said: ${hints}.` : '');
  for (const model of list(Deno.env.get('GEMINI_STT_MODELS'), ['gemini-flash-latest', 'gemini-flash-lite-latest'])) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: (file.type || 'audio/wav').split(';')[0], data } }, { text }] }], generationConfig: { temperature: 0 } }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) { console.error('STT gemini', model, res.status, (await res.text().catch(() => '')).slice(0, 300)); continue; }
      const j = await res.json();
      const out = (j.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('').trim();
      return out || null;
    } catch (err) { console.error('STT gemini', model, err); }
  }
  return null;
}


/**
 * Whisper (with the amount retry), Gemini and, when set up, the Krio listener (Meta Omnilingual ASR, trained on Krio)
 * listen at the same time. alt = the second version and krio = the Krio listener's, for the app to combine.
 */
export async function transcribe(file: File, lang: string, hints = ''): Promise<{ text: string; provider: string; alt?: string; krio?: string }> {
  const second = geminiListen(file, lang, hints).catch(() => null);
  const first = whisper(file, lang).catch((e) => { console.error('STT whisper', e); return null; });
  const third = krioListen(file, lang);
  const [w, alt, krio] = await Promise.all([first, second, third]);
  const k = krio ? { krio } : {};
  // Krio: Whisper only knows English and guesses English words; Gemini writes Krio well. So when the speech is Krio
  // (the app is in Krio, or Gemini's version is clearly Krio) Gemini's version leads and Whisper's is the backup.
  if (alt && w?.text && (lang === 'kri' || krioWords(alt) >= 2)) return { text: alt, provider: 'gemini', alt: w.text, ...k };
  if (w?.text) return { ...w, ...(alt && alt !== w.text ? { alt } : {}), ...k };
  if (alt) return { text: alt, provider: 'gemini', ...k };
  if (krio) return { text: krio, provider: 'krio' };
  throw new Error('Voice service is busy. Please type instead.');
}

/**
 * The Krio listener on Kopor's free Hugging Face Space (krio-listener/ in this repo). It is free but slow to wake after
 * a quiet spell, so it gets a short time limit and is simply skipped when it is late, asleep or not set up.
 */
async function krioListen(file: File, lang: string): Promise<string | null> {
  const url = Deno.env.get('KRIO_LISTENER_URL'), key = Deno.env.get('KRIO_LISTENER_KEY');
  if (!url || !key || file.type !== 'audio/wav' || file.size > 1_300_000) return null;
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/transcribe?lang=${lang === 'kri' ? 'kri' : 'en'}`, {
      method: 'POST', headers: { 'x-krio-key': key, 'Content-Type': 'audio/wav' }, body: file, signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) { console.error('STT krio', res.status); return null; }
    const text = String((await res.json())?.text ?? '').trim();
    return text || null;
  } catch (e) { console.error('STT krio', e instanceof Error ? e.name : e); return null; }
}

async function whisper(file: File, lang: string): Promise<{ text: string; provider: string }> {
  // Customer/product names are NOT put in Whisper's prompt: tested live, they made it drop amounts ("360 Leones").
  // Names are matched afterwards instead (Gemini's version, fuzzy matching and the AI correction step in the app).
  const prompt = KRIO_PROMPT;
  const e = (k: string) => Deno.env.get(k) || undefined;
  const chain = [
    { name: 'groq', base: 'https://api.groq.com/openai/v1', key: e('GROQ_API_KEY'), models: list(e('GROQ_STT_MODELS'), ['whisper-large-v3', 'whisper-large-v3-turbo']) },
    { name: 'custom', base: e('STT_BASE_URL') ?? '', key: e('STT_API_KEY'), models: list(e('STT_MODEL'), []) },
  ].filter((p) => p.key && p.base).flatMap((p) => p.models.map((model) => ({ p, model })));
  if (!chain.length) throw new Error('No speech-to-text provider configured');
  const ask = async (p: (typeof chain)[number]['p'], model: string, withPrompt: boolean): Promise<string | null> => {
    const form = new FormData();
    form.append('file', file, file.name || 'speech.webm');
    form.append('model', model);
    form.append('language', lang === 'fr' ? 'fr' : 'en'); // Krio is closest to English for Whisper
    if (withPrompt && lang !== 'fr') form.append('prompt', prompt);
    form.append('response_format', 'json');
    form.append('temperature', '0');
    try {
      const res = await fetch(`${p.base}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${p.key}` }, body: form, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) { console.error('STT', p.name, model, res.status, await res.text().catch(() => '')); return null; }
      return String((await res.json()).text ?? '').trim();
    } catch (err) { console.error('STT', p.name, model, err); return null; }
  };
  // Whisper sometimes skips the amount (tested live: the same clip kept "360 Leones" on one try and lost it on the next).
  // The amount is the most important part of a record, so when it is missing, ask once more another way
  // (the other model, then without the prompt) and keep the first answer that has one.
  for (const { p, model } of chain) {
    const text = await ask(p, model, true);
    if (text === null) continue;
    if (hasAmount(text) || !text) return { text, provider: p.name };
    const first = { text, provider: p.name };
    // Both retries run at the same time, so the person waits for one extra call at most.
    const other = chain.find((c) => c.model !== model);
    const retries = await Promise.all([other ? ask(other.p, other.model, true) : null, ask(p, model, false)]);
    const again = retries.find((t) => t && hasAmount(t));
    return again ? { text: again, provider: p.name } : first;
  }
  // Backup: Whisper on Cloudflare Workers AI (free daily allowance) when its account id and token are set.
  const cfAccount = e('CLOUDFLARE_ACCOUNT_ID'), cfToken = e('CLOUDFLARE_API_TOKEN');
  if (cfAccount && cfToken) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${cfAccount}/ai/run/@cf/openai/whisper-large-v3-turbo`, {
        method: 'POST', headers: { Authorization: `Bearer ${cfToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio: b64(bytes), language: lang === 'fr' ? 'fr' : 'en', initial_prompt: lang === 'fr' ? undefined : prompt }),
        signal: AbortSignal.timeout(40_000),
      });
      if (res.ok) { const j = await res.json(); const text = String(j.result?.text ?? '').trim(); if (text) return { text, provider: 'cloudflare' }; }
      else console.error('STT cloudflare', res.status, await res.text().catch(() => ''));
    } catch (err) { console.error('STT cloudflare', err); }
  }
  throw new Error('Voice service is busy. Please type instead.');
}
