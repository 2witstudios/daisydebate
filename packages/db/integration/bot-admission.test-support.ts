import { createId } from '@paralleldrive/cuid2';
import type { ReleaseAdmission } from '@daisy/db/flags';
import {
  admitAllowance,
  allowanceCeilings,
  canUseAiAllowance,
} from '@daisy/auth/authorization';
import type { BoundedTransaction } from '../src/bounded-transaction';
import { createRoundBotAdmission } from '../src/round-bot-admission';
import { createAuthorizationSubject } from './authorization.test-support';
import { withBoundedRound } from './bounded-transaction.test-support';
import type { Fixture } from './constraint-helpers';

/**
 * The policy production composes, with the bot Round per-day fair-use
 * ceiling tightened to `dailyCeiling` so a test can reach it (ADR 0146).
 */
export const betaAllowance = (
  dailyCeiling: number = allowanceCeilings.premiumPerDay.ai_round,
) => ({
  accountEligible: canUseAiAllowance,
  allowance: (
    account: Parameters<typeof admitAllowance>[0],
    facts: Parameters<typeof admitAllowance>[1],
    request: Parameters<typeof admitAllowance>[2],
    now: string,
  ) =>
    admitAllowance(account, facts, request, {
      betaGrantsPremium: true,
      now,
      ceilings: {
        ...allowanceCeilings,
        premiumPerDay: {
          ...allowanceCeilings.premiumPerDay,
          ai_round: dailyCeiling,
        },
      },
    }),
});

/** A canonical member, approved for the beta unless `beta` says otherwise, hosting `roundIds`. */
export async function admissionSponsor(
  fixture: Fixture,
  roundIds: readonly string[],
  beta: 'approved' | 'pending' = 'approved',
) {
  const { actorId } = await createAuthorizationSubject(fixture, beta);
  for (const roundId of roundIds)
    await fixture.sql`update rounds set created_by_actor_id=${actorId} where id=${roundId}`;
  return actorId;
}

/**
 * `bot-debates` decided as released. Release is the application's decision
 * (apps/web's catalogue and resolver, ADR 0921) and these suites prove
 * allowance and capacity under it; the web suites decide it from the real
 * account override, and `bot-admission.integration.ts` proves the refusal.
 */
export const botDebatesReleased: ReleaseAdmission = {
  keys: ['bot-debates'],
  decide: () => true,
};

/** Real admission at busy cap `busyCap` with the beta policy. */
export const testBotAdmission = (
  run: BoundedTransaction,
  busyCap = 4,
  dailyCeiling?: number,
) => {
  const admission = createRoundBotAdmission({
    run,
    nextId: createId,
    busyCap,
    ...betaAllowance(dailyCeiling),
  });
  return {
    ...admission,
    reserve: (target: Parameters<typeof admission.reserve>[0]) =>
      admission.reserve(target, botDebatesReleased),
  };
};

/** Two Rounds hosted by one approved sponsoring member, with real admission at busy cap 4 and an optional daily ceiling. */
export const withTwoRoundAdmission = (
  work: (context: {
    readonly fixture: Fixture;
    readonly run: BoundedTransaction;
    readonly firstRound: string;
    readonly secondRound: string;
    readonly actorId: string;
    readonly admission: ReturnType<typeof createRoundBotAdmission>;
  }) => Promise<void>,
  dailyCeiling?: number,
) =>
  withBoundedRound(async (fixture, run, firstRound) => {
    const secondRound = await fixture.round();
    const actorId = await admissionSponsor(fixture, [firstRound, secondRound]);
    const admission = testBotAdmission(run, 4, dailyCeiling);
    await work({ fixture, run, firstRound, secondRound, actorId, admission });
  });
