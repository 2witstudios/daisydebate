import { type AgeStepStore } from '../src/stores/age-step';
import { type BetaAccessStore } from '../src/stores/beta-access';
import { type MailStore } from '../src/stores/mail';
import { type OnboardingStore } from '../src/stores/onboarding';
import { type OperatorAccountsStore } from '../src/stores/operator-accounts';
import { createAppError } from '@daisy/errors';
import type { decidePreapprovalChange } from '@daisy/protocol/beta-preapproval';

type Input = Parameters<
  (AgeStepStore &
    BetaAccessStore &
    MailStore &
    OnboardingStore &
    OperatorAccountsStore)['preapprovalCommand']
>[0] & {
  readonly decide: typeof decidePreapprovalChange;
};

/** Store-test composition only; production route exercises its own application driver. */
export async function executePreapprovalCommand(
  store: Pick<
    AgeStepStore &
      BetaAccessStore &
      MailStore &
      OnboardingStore &
      OperatorAccountsStore,
    'preapprovalCommand'
  >,
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
