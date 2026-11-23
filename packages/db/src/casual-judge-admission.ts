import { createAppError } from '@daisy/errors';
import { lockAuthorizationActors } from './authorization';
import { roundHasAiJudge } from './round-ai-judge';
import { lockUsageSponsor } from './usage-sponsor';
import {
  reserveUsageLocked,
  readAllowanceLocked,
  type AiAllowanceOptions,
} from './usage-ledger';
import type { Tx } from './tx';

/** Casual judging consumes the shared ledger, independently of bot capacity. */
export function createCasualJudgeAdmission(input: {
  readonly policy: AiAllowanceOptions;
  readonly nextId: () => string;
}) {
  return {
    quoteLocked: async (
      tx: Tx,
      target: {
        readonly account: Awaited<
          ReturnType<typeof lockAuthorizationActors>
        >[number];
        readonly roundId: string | null;
        readonly withBot: boolean;
      },
    ) => {
      const judge = await readAllowanceLocked(tx, {
        account: target.account,
        request: { kind: 'casual_judge', roundId: target.roundId },
        decide: input.policy.decide,
      });
      // Only an initial free bot bundle can establish the missing judge binding.
      // Paid judging remains available even when the separate bot quota is spent.
      return target.withBot &&
        judge.decision.kind === 'refuse' &&
        judge.decision.reason === 'free-judge-unbound'
        ? readAllowanceLocked(tx, {
            account: target.account,
            request: {
              kind: 'bot_debate',
              roundId: target.roundId,
              withJudge: true,
            },
            decide: input.policy.decide,
          })
        : judge;
    },
    reserveLocked: async (
      tx: Tx,
      target: { readonly actorId: string; readonly roundId: string },
    ) => {
      const account = await lockUsageSponsor(tx, target);
      if (!(await roundHasAiJudge(tx, target.roundId)))
        throw createAppError('CONFLICT');
      return reserveUsageLocked(tx, {
        account: account ?? null,
        nextId: input.nextId,
        decide: input.policy.decide,
        accountEligible: input.policy.accountEligible,
        request: { kind: 'casual_judge', roundId: target.roundId },
      });
    },
  };
}
export type CasualJudgeAdmission = ReturnType<
  typeof createCasualJudgeAdmission
>;
