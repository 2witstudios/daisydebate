import type { Database } from '@daisy/db';
import { createAppError } from '@daisy/errors';
import type { createRefundVendor } from './refund-vendor';

type Store = Pick<
  ReturnType<Database['billingRefunds']>,
  'actions' | 'claim' | 'record'
>;
type Observation = Awaited<
  ReturnType<ReturnType<typeof createRefundVendor>['run']>
>;
type FailureStage = 'discover' | 'claim' | 'vendor' | 'record';
/** Action-owned reads continue after customer deletion or privacy-job acknowledgement. */
export function createRefundReconciliation(input: {
  readonly store: Store;
  readonly vendor: Pick<ReturnType<typeof createRefundVendor>, 'run'>;
  readonly mode: 'test' | 'live';
  readonly failed: (error: unknown, stage: FailureStage) => void;
}) {
  let afterId: string | undefined;
  let stopped = false;
  let running = false;
  async function reconcile(actionId: string) {
    let stage: FailureStage = 'claim';
    try {
      const claim = await input.store.claim(actionId);
      if (!claim || stopped || claim.work === 'wait' || claim.work === 'refuse')
        return;
      if (!claim.action.claim) throw createAppError('INVARIANT');
      if (claim.action.mode !== input.mode) throw createAppError('CONFLICT');
      const claimId = claim.action.claim.id;
      stage = 'vendor';
      const observed = await input.vendor.run(claim.action, claimId);
      stage = 'record';
      // Account for an in-flight result even if shutdown was requested during transport.
      await record(actionId, claimId, observed);
    } catch (error) {
      input.failed(error, stage);
    }
  }
  async function record(
    actionId: string,
    claimId: string,
    observed: Observation,
  ) {
    const result = await input.store.record(
      actionId,
      observed.kind === 'refuse' ? { kind: 'unresolved', claimId } : observed,
    );
    if (observed.kind === 'refuse' || observed.kind === 'unresolved')
      input.failed(createAppError('INFRASTRUCTURE'), 'vendor');
    if (result === 'refuse' || result === 'missing')
      input.failed(createAppError('CONFLICT'), 'record');
  }
  return {
    async run() {
      if (stopped || running) return;
      running = true;
      try {
        // Each vendor action performs at most two bounded reads; three identities bound one tick.
        const page = await input.store.actions({
          mode: input.mode,
          limit: 3,
          ...(afterId === undefined ? {} : { afterId }),
        });
        for (const { actionId } of page.rows) {
          if (stopped) return;
          await reconcile(actionId);
        }
        afterId = page.exhausted ? undefined : (page.afterId ?? undefined);
      } catch (error) {
        input.failed(error, 'discover');
      } finally {
        running = false;
      }
    },
    stop() {
      stopped = true;
    },
  };
}
