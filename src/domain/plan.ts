// Free vs Pro. Free stays genuinely useful for a single shop; Pro unlocks growth (more branches & staff).
// Limits are enforced here for a good message AND in Postgres (0003 migration) so they cannot be bypassed.
import type { Org } from '@/db/schema';

export const FREE_LIMITS = { branches: 1, staff: 3 } as const;
/** Daily cloud AI requests (voice, receipt scans, advisor); must match AI_DAILY_LIMIT / AI_DAILY_LIMIT_PRO in the ai function. */
export const AI_PER_DAY = { free: 50, pro: 500 } as const;
export const PRO_PRICE_MINOR = 7500; // Le 75 / month (configure the real price on the server)

export const isPro = (org: Pick<Org, 'plan' | 'plan_until'>, now = Date.now()) => org.plan === 'pro' && (org.plan_until ?? 0) > now;
