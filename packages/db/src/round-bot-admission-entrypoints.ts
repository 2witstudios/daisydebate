import { createRoundBotAdmission } from './round-bot-admission';
import type { BoundedTransaction } from './bounded-transaction';

/** One configured admission resource serves Room freeze and host status. */
export function roundBotAdmissionEntrypoints(input: {
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
  readonly busyCap: number | undefined;
}) {
  const admission =
    input.busyCap === undefined
      ? undefined
      : createRoundBotAdmission({ ...input, busyCap: input.busyCap });
  return {
    admission,
    operations: {
      readRoundBotAdmissionStatus: async (actorId: string) =>
        admission ? admission.readStatus(actorId) : null,
    },
  };
}
