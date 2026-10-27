import {
  createRoundBotAdmission,
  type AiRoundAllowance,
} from './round-bot-admission';
import type { BoundedTransaction } from './bounded-transaction';

/** Trusted bot admission: an explicit live bot-debater bound and the quota policy, together. */
export type BotAdmissionOptions = {
  readonly busyCap: number;
  readonly allowance: AiRoundAllowance;
};

/** One configured admission resource serves Room freeze and host status. */
export function roundBotAdmissionEntrypoints(input: {
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
  readonly botAdmission: BotAdmissionOptions | undefined;
}) {
  const admission =
    input.botAdmission === undefined
      ? undefined
      : createRoundBotAdmission({
          run: input.run,
          nextId: input.nextId,
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
