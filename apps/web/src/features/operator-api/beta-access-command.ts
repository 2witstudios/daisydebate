import type { Database } from '@daisy/db';
import { createAppError } from '@daisy/errors';
import { ageAdmitted } from '@daisy/auth/authorization';
import { decideBetaAccessChange } from '@daisy/protocol/beta-access';

type Store = Pick<Database, 'betaAccessCommand'>;
type Input = Parameters<Store['betaAccessCommand']>[0];
type Session = Parameters<Parameters<Store['betaAccessCommand']>[1]>[0];
type Fresh = Extract<Awaited<ReturnType<Session['load']>>, { kind: 'fresh' }>;

/** Fresh authority and policy run only after the store's account fence and receipt replay. */
export async function runBetaAccessCommand(
  store: Store,
  input: Input,
  authorize: (account: NonNullable<Fresh['account']>) => boolean,
) {
  return store.betaAccessCommand(input, async (session) => {
    const loaded = await session.load();
    if (loaded.kind !== 'fresh') return;
    const account = loaded.account;
    if (!account || account.erased || account.userId !== input.targetUserId)
      throw createAppError('NOT_FOUND');
    if (!authorize(account)) throw createAppError('AUTHORIZATION');
    const decision = decideBetaAccessChange({
      current: account.beta,
      desired: input.desired,
      expectedRevision: input.expectedRevision,
      ageAdmitted: ageAdmitted(account.ageBand),
    });
    if (decision.kind === 'refused')
      throw createAppError(
        (
          {
            stale: 'CONFLICT',
            'not-found': 'NOT_FOUND',
            'age-required': 'INVARIANT',
          } as const
        )[decision.reason],
      );
    await loaded.apply(decision);
  });
}
