import { type BetaAccessStore } from '@daisy/db/stores/beta-access';
import { createAppError } from '@daisy/errors';
import { decidePreapprovalChange } from '@daisy/protocol/beta-preapproval';

type Store = Pick<BetaAccessStore, 'preapprovalCommand'>;
type Input = Parameters<Store['preapprovalCommand']>[0];

/** A new account discovered after the email fence gets a new account-first attempt. */
export async function runPreapprovalCommand(store: Store, input: Input) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!input.live()) throw createAppError('CONFLICT');
    const result = await store.preapprovalCommand(input, async (session) => {
      const loaded = await session.load();
      if (loaded.kind !== 'fresh') return;
      const decision = decidePreapprovalChange(loaded.facts);
      if (decision.kind === 'refused') throw createAppError(decision.code);
      await loaded.apply(decision);
    });
    if (result.kind === 'settled') return result.result;
  }
  throw createAppError('CONFLICT');
}
