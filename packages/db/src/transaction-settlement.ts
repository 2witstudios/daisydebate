import type { ReservedSQL, SQL } from 'bun';
import { deadlineSignal, type Waits } from '@daisy/clock';
import {
  recoverTransactionBackend,
  type OwnedBackend,
} from './transaction-watchdog';

export type TransactionSettlement = {
  /** Backend absence is not evidence of COMMIT versus rollback. */
  readonly settled: Promise<'backend-absent'>;
  readonly confirm: () => Promise<boolean>;
};

/** Only positive exact-incarnation verification settles uncertainty. Never use expiry. */
export function transactionSettlement(input: {
  readonly client: SQL;
  readonly backend: OwnedBackend | undefined;
  readonly absent: boolean;
  /** The time a confirmation's 1 s budget is measured on (R4.7). */
  readonly waits: Waits;
}): TransactionSettlement {
  let absent = input.absent;
  const { promise: settled, resolve } =
    Promise.withResolvers<'backend-absent'>();
  const markAbsent = () => {
    absent = true;
    resolve('backend-absent');
  };
  if (absent) markAbsent();
  let checking: Promise<boolean> | undefined;
  const verify = async () => {
    if (absent) return true;
    if (!input.backend) return false;
    const deadline = input.waits.nowMs() + 1000;
    const bound = deadlineSignal(input.waits, 1000);
    let control: ReservedSQL | undefined;
    let confirmed = false;
    try {
      control = await input.client.reserve({ signal: bound.signal });
      const remaining = deadline - input.waits.nowMs();
      if (remaining <= 0) return false;
      confirmed = await recoverTransactionBackend(
        input.waits,
        control,
        input.backend,
        remaining,
      );
      if (confirmed) markAbsent();
      return confirmed;
    } catch {
      return false;
    } finally {
      bound.clear();
      if (confirmed) control?.release();
      else void control?.close({ timeout: 0 }).catch(() => undefined);
    }
  };
  return Object.freeze({
    settled,
    confirm: () => {
      checking ??= verify().finally(() => {
        checking = undefined;
      });
      return checking;
    },
  });
}
