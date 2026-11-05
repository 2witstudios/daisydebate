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

/** Pause an actual bounded writer after its effects, before its COMMIT. */
export function holdCommit(run: BoundedTransaction) {
  const entered = Promise.withResolvers<number>();
  const finish = Promise.withResolvers<void>();
  const held: BoundedTransaction = (work, options) =>
    run(async (...args) => {
      const result = await work(...args);
      entered.resolve(args[2].writer.pid);
      await finish.promise;
      return result;
    }, options);
  return {
    run: held,
    entered: entered.promise,
    release: () => finish.resolve(),
  };
}
