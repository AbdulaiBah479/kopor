// Free-tier AI with automatic fallback: each provider/model has its own free quota, so when one is rate-limited,
// down or retired, the next one answers. Providers are enabled simply by adding their key as a secret.
// (Free tiers listed in github.com/cheahjs/free-llm-api-resources.)

type Msg = { role: string; content: unknown };
interface Provider { name: string; base: string; key?: string; text: string[]; vision: string[]; extra?: (model: string) => Record<string, unknown> }

const list = (v: string | undefined, d: string[]) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : d);
const gptOss = (m: string) => (/gpt-oss/.test(m) ? { reasoning_effort: 'low' } : {});

function providers(): Provider[] {
  const e = (k: string) => Deno.env.get(k) || undefined;
  return [
    // Custom OpenAI-compatible endpoint first, if configured (e.g. a self-hosted model).
    { name: 'custom', base: e('AI_BASE_URL') ?? '', key: e('AI_API_KEY'), text: list(e('AI_MODEL'), []), vision: list(e('AI_VISION_MODEL'), []), extra: gptOss },
    { name: 'groq', base: 'https://api.groq.com/openai/v1', key: e('GROQ_API_KEY'),
      text: list(e('GROQ_MODELS'), ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b']), vision: list(e('GROQ_VISION_MODELS'), ['qwen/qwen3.8-27b']), extra: gptOss },
    { name: 'gemini', base: 'https://generativelanguage.googleapis.com/v1beta/openai', key: e('GEMINI_API_KEY'),
      text: list(e('GEMINI_MODELS'), ['gemini-flash-latest', 'gemini-flash-lite-latest']), vision: list(e('GEMINI_MODELS'), ['gemini-flash-latest', 'gemini-flash-lite-latest']) },
    { name: 'cerebras', base: 'https://api.cerebras.ai/v1', key: e('CEREBRAS_API_KEY'), text: list(e('CEREBRAS_MODELS'), ['gpt-oss-120b']), vision: [], extra: gptOss },
    { name: 'mistral', base: 'https://api.mistral.ai/v1', key: e('MISTRAL_API_KEY'),
      text: list(e('MISTRAL_MODELS'), ['mistral-small-latest']), vision: list(e('MISTRAL_VISION_MODELS'), ['mistral-small-latest']) },
    { name: 'github', base: 'https://models.github.ai/inference', key: e('GITHUB_MODELS_TOKEN'),
      text: list(e('GITHUB_MODELS'), ['openai/gpt-4.1-mini']), vision: list(e('GITHUB_MODELS'), ['openai/gpt-4.1-mini']) },
    { name: 'openrouter', base: 'https://openrouter.ai/api/v1', key: e('OPENROUTER_API_KEY'),
      text: list(e('OPENROUTER_MODELS'), ['openrouter/free']), vision: list(e('OPENROUTER_VISION_MODELS'), []) },
  ].filter((p) => p.key && p.base);
}

// Remember rate-limited models for a while (per function instance) so we skip straight to one that works.
const cooldown = new Map<string, number>();

export interface LlmResult { content: string; provider: string; model: string }

export async function complete(messages: Msg[], opts: { vision?: boolean; maxTokens?: number } = {}): Promise<LlmResult> {
  const errors: string[] = [];
  const chain = providers().flatMap((p) => (opts.vision ? p.vision : p.text).map((model) => ({ p, model })));
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
    }
  }
  console.error('All AI providers failed', errors);
  throw new Error('AI is busy right now. Kopor will use offline mode.');
}
