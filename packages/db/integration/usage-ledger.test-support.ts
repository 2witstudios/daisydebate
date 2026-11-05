import { createId } from '@paralleldrive/cuid2';
import { canReleaseFreeJudgeBinding } from '@daisy/auth/authorization';
import type { BoundedTransaction } from '../src/bounded-transaction';
import { createUsageRelease } from '../src/usage-release';
import { withBoundedRound } from './bounded-transaction.test-support';
import {
  admissionSponsor,
  testBotAdmission,
} from './bot-admission.test-support';

export async function withFreeBundle(
  work: (input: {
    f: Parameters<Parameters<typeof withBoundedRound>[0]>[0];
    run: BoundedTransaction;
    roundId: string;
    replacement: string;
    actorId: string;
    admission: ReturnType<typeof testBotAdmission>;
    release: ReturnType<typeof createUsageRelease>;
  }) => Promise<void>,
) {
  await withBoundedRound(async (f, run, roundId) => {
    const replacement = await f.round();
    const actorId = await admissionSponsor(f, [roundId, replacement]);
    await f.sql`delete from account_entitlement_grants where user_id=(select user_id from actors where id=${actorId})`;
    const judge = createId();
    await f.insert('actors', { id: judge, kind: 'bot', user_id: null });
    await f.seat(roundId, 'judge', 0, judge);
    await f.seat(replacement, 'judge', 0, judge);
    const admission = testBotAdmission(run);
    await admission.reserve({ actorId, roundId });
    await work({
      f,
      run,
      roundId,
      replacement,
      actorId,
      admission,
      release: createUsageRelease({
        run,
        releaseBinding: canReleaseFreeJudgeBinding,
      }),
    });
  });
}

type HeldCommit = {
  readonly run: BoundedTransaction;
  readonly entered: Promise<number>;
  readonly observe: <T>(work: Promise<T>) => Promise<T>;
  readonly release: () => void;
};

/** Own the holder and every contender through entry failure, assertions and cleanup. */
export async function withHeldCommit<T>(
  run: BoundedTransaction,
  work: (held: HeldCommit) => Promise<T>,
): Promise<T> {
  const entered = Promise.withResolvers<number>();
  const finish = Promise.withResolvers<void>();
  const pending: Promise<unknown>[] = [];
  // Keep rejection observed even when the holder fails before the caller awaits entry.
  void entered.promise.catch(() => undefined);
  const observe = <R>(operation: Promise<R>) => {
    pending.push(
      operation.then(
        () => undefined,
        () => undefined,
      ),
    );
    return operation;
  };
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const held: BoundedTransaction = (callback, options) => {
    const timer = setTimeout(() => {
      entered.reject(new Error('Held writer did not enter within 3000 ms'));
      finish.resolve();
    }, 3000);
    timers.add(timer);
    return observe(
      Promise.resolve()
        .then(() =>
          run(async (...args) => {
            const result = await callback(...args);
            clearTimeout(timer);
            entered.resolve(args[2].writer.pid);
            await finish.promise;
            return result;
          }, options),
        )
        .catch((error) => {
          entered.reject(error);
          finish.resolve();
          throw error;
        })
        .finally(() => clearTimeout(timer)),
    );
  };
  try {
    return await work({
      run: held,
      entered: entered.promise,
      observe,
      release: () => finish.resolve(),
    });
  } finally {
    finish.resolve();
    for (const timer of timers) clearTimeout(timer);
    await Promise.all(pending);
  }
}
