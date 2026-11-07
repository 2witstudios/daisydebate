import { createRoundBotAdmission } from './round-bot-admission';
import type { AiAllowanceOptions } from './usage-ledger';
import type { BoundedTransaction } from './bounded-transaction';
import { createAppError } from '@daisy/errors';

/** Bot capacity is independent of the shared account allowance policy. */
export type BotAdmissionOptions = {
  readonly busyCap: number;
};

/** One configured admission resource serves Room freeze and host status. */
export function roundBotAdmissionEntrypoints(input: {
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
  readonly botAdmission: BotAdmissionOptions | undefined;
  readonly aiAllowance: AiAllowanceOptions | undefined;
}) {
  if (input.botAdmission && !input.aiAllowance)
    throw createAppError(
      'VALIDATION',
      'Bot admission requires allowance policy',
    );
  const admission =
    input.botAdmission === undefined
      ? undefined
      : createRoundBotAdmission({
          run: input.run,
          nextId: input.nextId,
          allowance: input.aiAllowance!.decide,
          accountEligible: input.aiAllowance!.accountEligible,
          ...input.botAdmission,
        });
  return {
    admission,
    operations: {
      readRoundBotAdmissionStatus: async (actorId: string) =>
        admission ? admission.readStatus(actorId) : null,
    },
  };
}
