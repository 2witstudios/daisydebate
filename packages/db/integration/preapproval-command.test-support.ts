import { createAppError } from '@daisy/errors';
import type { decidePreapprovalChange } from '@daisy/protocol/beta-preapproval';
import type { Database } from '../src';

type Input = Parameters<Database['preapprovalCommand']>[0] & {
  readonly decide: typeof decidePreapprovalChange;
};

/** Store-test composition only; production route exercises its own application driver. */
export async function executePreapprovalCommand(
  store: Pick<Database, 'preapprovalCommand'>,
  input: Input,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!input.live()) throw createAppError('CONFLICT');
    const result = await store.preapprovalCommand(input, async (session) => {
      const loaded = await session.load();
      if (loaded.kind !== 'fresh') return;
      const decision = input.decide(loaded.facts);
      if (decision.kind === 'refused') throw createAppError(decision.code);
      await loaded.apply(decision);
    });
    if (result.kind === 'settled') return result.result;
  }
  throw createAppError('CONFLICT');
}
