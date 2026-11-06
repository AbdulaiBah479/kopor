// Mobile money agent book (migration 0041). An agent keeps cash in the drawer and float (e-money) on each network's
// SIM; every deposit or withdrawal swaps one for the other. Kopor works out what each balance should be, and when the
// agent reads the real balances off the phones and counts the drawer, shows exactly how much is missing or extra.
// Record-keeping only: Kopor never moves the agent's money.
import type { AgentMove } from '@/db/schema';
import { insert, type Ctx } from '@/db/repo';
import { assertCan } from '@/db/permissions';
import { today } from '@/lib/dates';
import { AppError } from './book';

export const NETWORKS = ['orange', 'afrimoney', 'qmoney'] as const;
export type Network = (typeof NETWORKS)[number];
export type Account = Network | 'cash';
export const ACCOUNTS: Account[] = ['cash', ...NETWORKS];
export type AgentKind = Exclude<AgentMove['kind'], 'count'>;
export const KINDS: AgentKind[] = ['deposit', 'withdraw', 'commission', 'buy_float', 'sell_float'];

/** How one record changes the cash and the network's float. */
export function effect(kind: AgentKind, amount: number): { cash: number; float: number } {
  switch (kind) {
    case 'deposit': return { cash: amount, float: -amount };    // customer gives cash, agent sends e-money
    case 'withdraw': return { cash: -amount, float: amount };   // agent gives cash, receives e-money
    case 'commission': return { cash: 0, float: amount };       // paid by the network into the float
    case 'buy_float': return { cash: -amount, float: amount };
    case 'sell_float': return { cash: amount, float: -amount };
  }
}

export interface Check { at: number; date: string; expected: number; counted: number; diff: number }
export interface AgentState {
  balance: Record<Account, number>;
  /** Whether the balance is known (checked at least once); before that it only shows the change since starting. */
  known: Record<Account, boolean>;
  lastCheck: Partial<Record<Account, Check>>;
  day: { deposits: number; withdrawals: number; commission: number; count: number };
  commissionMonth: number;
}

const zero = (): Record<Account, number> => ({ cash: 0, orange: 0, afrimoney: 0, qmoney: 0 });

export function agentState(moves: AgentMove[], date = today()): AgentState {
  const balance = zero();
  const known: Record<Account, boolean> = { cash: false, orange: false, afrimoney: false, qmoney: false };
  const lastCheck: AgentState['lastCheck'] = {};
  const day = { deposits: 0, withdrawals: 0, commission: 0, count: 0 };
  let commissionMonth = 0;
  for (const m of moves.filter((x) => !x.deleted).sort((a, b) => a.created_at - b.created_at)) {
    if (m.kind === 'count') {
      const acc = m.network as Account;
      // The first check only sets the starting balance; later ones show what is missing (negative) or extra.
      if (known[acc]) lastCheck[acc] = { at: m.created_at, date: m.date, expected: balance[acc], counted: m.amount, diff: m.amount - balance[acc] };
      balance[acc] = m.amount; known[acc] = true;
      continue;
    }
    const e = effect(m.kind, m.amount);
    balance.cash += e.cash;
    balance[m.network as Network] += e.float;
    if (m.kind === 'commission' && m.date.slice(0, 7) === date.slice(0, 7)) commissionMonth += m.amount;
    if (m.date !== date) continue;
    day.count++;
    if (m.kind === 'deposit') day.deposits += m.amount;
    else if (m.kind === 'withdraw') day.withdrawals += m.amount;
    else if (m.kind === 'commission') day.commission += m.amount;
  }
  return { balance, known, lastCheck, day, commissionMonth };
}

export interface AgentInput { kind: AgentKind; network: Network; amount: number; phone?: string; note?: string }

/** Record one deposit, withdrawal, commission or float swap. Refuses what the known balances cannot cover. */
export async function recordAgent(ctx: Ctx, moves: AgentMove[], input: AgentInput) {
  assertCan(ctx.role, 'record');
  const amount = Math.round(input.amount);
  if (!(amount > 0)) throw new AppError('err.amount');
  if (!NETWORKS.includes(input.network) || !KINDS.includes(input.kind)) throw new AppError('err.amount');
  const s = agentState(moves);
  const e = effect(input.kind, amount);
  if (e.float < 0 && s.known[input.network] && s.balance[input.network] + e.float < 0) throw new AppError('agent.noFloat', { amount: s.balance[input.network] });
  if (e.cash < 0 && s.known.cash && s.balance.cash + e.cash < 0) throw new AppError('agent.noCash', { amount: s.balance.cash });
  const phone = (input.phone ?? '').replace(/[^\d+]/g, '').slice(0, 20);
  return insert(ctx, 'agent_moves', { branch_id: ctx.branchId ?? null, date: today(), kind: input.kind, network: input.network, amount, phone, note: (input.note ?? '').trim().slice(0, 200) },
    `Agent ${input.kind} ${input.network} ${amount / 100}`);
}

/** Save the real balances read off the phones and counted in the drawer (only the ones filled in). */
export async function checkBalances(ctx: Ctx, counted: Partial<Record<Account, number>>) {
  assertCan(ctx.role, 'record');
  const rows = ACCOUNTS.filter((a) => typeof counted[a] === 'number' && counted[a]! >= 0);
  if (!rows.length) throw new AppError('err.amount');
  for (const a of rows) {
    await insert(ctx, 'agent_moves', { branch_id: ctx.branchId ?? null, date: today(), kind: 'count', network: a, amount: Math.round(counted[a]!), phone: '', note: '' },
      `Agent balance check ${a} ${counted[a]! / 100}`);
  }
}
