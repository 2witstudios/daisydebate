import { AsyncLocalStorage } from 'node:async_hooks';
import { createAppError } from '@daisy/errors';

const backgroundWork = new AsyncLocalStorage<true>();
/**
 * Runs `work`, and every continuation it schedules (timers included), in the
 * background capacity class. Process-level loops start inside it; request
 * handlers never do (DEC-198).
 */
export const runAsBackgroundWork = <T>(work: () => T): T =>
  backgroundWork.run(true, work);
/** Whether the current async context belongs to the background class. */
const inBackgroundWork = () => backgroundWork.getStore() === true;
/** Slots of the transaction budget that only public request-scoped work may take. */
export const PUBLIC_TRANSACTION_RESERVE = 2;
/** Deterministic admission: public work may use the whole budget; background work leaves the reserve free. */
export function admitsTransaction(input: {
  readonly maxConnections: number;
  readonly active: number;
  readonly background: number;
  readonly backgroundWork: boolean;
}) {
  if (!Number.isSafeInteger(input.maxConnections) || input.maxConnections < 2)
    return false;
  const budget = Math.floor(input.maxConnections / 2);
  if (input.active >= budget) return false;
  return (
    !input.backgroundWork ||
    input.background < Math.max(1, budget - PUBLIC_TRANSACTION_RESERVE)
  );
}

/** Admits one transaction or refuses deterministically; the returned release frees its slot. */
export function createTransactionCapacity(maxConnections: number) {
  let active = 0,
    background = 0;
  return () => {
    const backgroundCaller = inBackgroundWork();
    if (
      !admitsTransaction({
        maxConnections,
        active,
        background,
        backgroundWork: backgroundCaller,
      })
    )
      throw createAppError(
        'INFRASTRUCTURE',
        'Transcript transaction capacity unavailable',
      );
    active += 1;
    if (backgroundCaller) background += 1;
    return () => {
      active -= 1;
      if (backgroundCaller) background -= 1;
    };
  };
}
