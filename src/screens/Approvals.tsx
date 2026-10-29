// Two-person approval: when a staff member's action needs the owner (a big refund, deleting an old record, credit
// above the limit), their phone sends a request; the owner sees it here, enters their PIN, and their own phone does
// the action as the owner (the server only accepts it from the owner).
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '@/state/app';
import { useOverlay } from '@/ui/overlay';
import { Icon } from '@/ui/Icon';
import { Money } from '@/ui/widgets';
import { usePinCheck } from '@/ui/PinCheck';
import { decideApproval, pendingApprovals, requestApproval, type Approval, type ApprovalRequest } from '@/cloud/protect';
import { syncNow } from '@/cloud/sync';
import { recordReturn, type ReturnLine } from '@/domain/returns';
import { deleteTxn, recordSale, type SaleInput } from '@/domain/cash';
import { addEntry, removeEntry, type EntryInput } from '@/domain/credit';
import type { Ctx } from '@/db/repo';

/** Do what was asked, as the owner. */
async function carryOut(ctx: Ctx, a: Approval) {
  const p = a.payload;
  if (a.kind === 'refund') await recordReturn(ctx, String(p.saleId), p.lines as ReturnLine[], (p.opts ?? {}) as Parameters<typeof recordReturn>[3]);
  else if (a.kind === 'delete') await (p.txnId ? deleteTxn(ctx, String(p.txnId)) : removeEntry(ctx, String(p.entryId)));
  else if (a.kind === 'credit') await addEntry(ctx, p as unknown as EntryInput);
  else if (a.kind === 'sale') await recordSale(ctx, p as unknown as SaleInput);
}

/** Owner: requests waiting for approval (shown at the top of Fraud watch). */
export function ApprovalsCard() {
  const { t } = useTranslation();
  const { ctx, can, sync } = useApp();
  const { toast, fail } = useOverlay();
  const askPin = usePinCheck();
  const [list, setList] = useState<Approval[]>([]);
  const load = useCallback(() => { pendingApprovals(ctx.orgId).then(setList).catch(() => {}); }, [ctx.orgId]);
  useEffect(() => { if (can('business') && sync.status !== 'off') load(); }, [load, can, sync.status, sync.lastSync]);
  if (!list.length) return null;
  const decide = async (a: Approval, yes: boolean) => {
    try {
      if (!(await askPin())) return;
      if (yes) await carryOut(ctx, a);
      await decideApproval(a.id, yes);
      void syncNow(ctx.orgId);
      toast(t(yes ? 'approve.done' : 'approve.rejected'));
      load();
    } catch (e) { fail(e); }
  };
  return (
    <div className="card stack" data-testid="approvals">
      <b><Icon name="shield" size={18} className="mr-1 inline" />{t('approve.title', { count: list.length })}</b>
      <div className="list">
        {list.map((a) => (
          <div key={a.id} className="item" style={{ flexWrap: 'wrap' }}>
            <div className="main"><div className="t">{a.summary}</div><div className="s">{t('approve.by', { who: a.requested_name, time: new Date(a.at).toLocaleString() })}</div></div>
            {a.amount > 0 && <Money v={a.amount} />}
            <div className="btn-row" style={{ width: '100%' }}>
              <button className="btn primary sm" data-testid="approve-yes" onClick={() => decide(a, true)}><Icon name="check" size={16} /> {t('approve.yes')}</button>
              <button className="btn ghost sm" onClick={() => decide(a, false)}>{t('approve.no')}</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Sends "ask the owner" requests raised by the error message's button (see overlay.fail). */
export function ApprovalBridge() {
  const { t } = useTranslation();
  const { ctx } = useApp();
  const { toast, fail } = useOverlay();
  useEffect(() => {
    const on = (e: Event) => {
      const r = (e as CustomEvent<ApprovalRequest>).detail;
      requestApproval(ctx.orgId, r).then(() => toast(t('approve.sent'))).catch(fail);
    };
    window.addEventListener('kopor-approval', on);
    return () => window.removeEventListener('kopor-approval', on);
  }, [ctx.orgId, toast, fail, t]);
  return null;
}
