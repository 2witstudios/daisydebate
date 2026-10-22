import type { ReservedSQL, SQL } from 'bun';
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
  readonly now: () => number;
}): TransactionSettlement {
  let markAbsent: () => void;
  let absent = input.absent;
  const settled = new Promise<'backend-absent'>((resolve) => {
    markAbsent = () => {
      absent = true;
      resolve('backend-absent');
    };
  });
  if (absent) markAbsent!();
  let checking: Promise<boolean> | undefined;
  const verify = async () => {
    if (absent) return true;
    if (!input.backend) return false;
    const controller = new AbortController();
    const deadline = input.now() + 1000;
    const timer = setTimeout(() => controller.abort(), 1000);
    let control: ReservedSQL | undefined;
    let confirmed = false;
    try {
      control = await input.client.reserve({ signal: controller.signal });
      const remaining = deadline - input.now();
      if (remaining <= 0) return false;
      confirmed = await recoverTransactionBackend(
        control,
        input.backend,
        remaining,
      );
      if (confirmed) markAbsent!();
      return confirmed;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
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
