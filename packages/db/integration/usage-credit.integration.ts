import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import { usageStateSchema } from '@daisy/protocol/billing';
import {
  refundPlatformEndedLocked,
  refundUnservedPracticeLocked,
} from '../src/round-bot-admission';
import { withGeneration } from './bot-generation.test-support';

setupRitewayBun();
requireTestServices(process.env);

for (const provider of ['received', 'failed', 'unknown'] as const) {
  test(`platform credit and provider ${provider} settlement race without double restoration or lost evidence`, async () => {
    await withGeneration(
      async ({ fixture: f, run, target, operations, reservation }) => {
        const claim = await operations.claimWorker(target);
        const begun = await operations.beginGeneration(
          claim.scope,
          claim.token,
          { kind: 'language' },
        );
        if (provider !== 'unknown')
          await operations.finishGeneration(
            claim.scope,
            begun.execution,
            provider,
            {
              inputTokens: provider === 'received' ? 7 : 0,
              outputTokens: provider === 'received' ? 3 : 0,
              characters: 0,
            },
          );
        const [original] =
          await f.sql`select source,state,reserved_at from usage_reservations where id=${reservation.id}`;
        const incidentId = createId();
        await f.insert('round_incidents', {
          id: incidentId,
          round_id: target.roundId,
          cause: 'vendor_unreachable',
          detected_at: new Date(),
          ended_at: new Date(),
        });
        await f.sql`update rounds set status='abandoned',current_stage=null,completed_at=clock_timestamp(),platform_ending='recovery_bound' where id=${target.roundId}`;
        const credit = () =>
          run(async (tx) => {
            await tx.execute(
              sql`select id from rounds where id=${target.roundId} for no key update`,
            );
            await refundPlatformEndedLocked(tx, target.roundId, {
              kind: 'recovery_bound',
              incidentId,
            });
          });
        const settle = () =>
          run(async (tx) => {
            await tx.execute(
              sql`select id from rounds where id=${target.roundId} for no key update`,
            );
            await refundUnservedPracticeLocked(tx, target.roundId);
          });
        await Promise.all([credit(), settle()]);
        const [first] =
          await f.sql`select source,state,reserved_at from usage_reservations where id=${reservation.id}`;
        await Promise.all([settle(), credit()]);
        const [after] = await f.sql`select source,state,reserved_at,
        (select count(*)::int from usage_reservations where actor_id=${reservation.actorId} and state->>'kind' in ('refunded','credited')) as restorations,
        (select sum(requests)::int from agent_runs where round_participant_id=${target.roundParticipantId}) as requests,
        (select sum(input_tokens)::int from agent_runs where round_participant_id=${target.roundParticipantId}) as input_tokens
        from usage_reservations where id=${reservation.id}`;
        const state = usageStateSchema.parse(after.state);
        const outcome =
          state.kind === 'credited'
            ? state.providerOutcome
            : state.kind === 'refunded'
              ? 'definite_failure'
              : state.kind;
        assert({
          given: `a counted ${provider} provider call with concurrent qualifying platform relief and terminal settlement`,
          should:
            'restore once, retain attribution/count and provider exposure, and make retries unchanged',
          actual: {
            restorations: after.restorations,
            stateStable:
              JSON.stringify(first.state) === JSON.stringify(after.state),
            sourceStable:
              JSON.stringify(original.source) === JSON.stringify(after.source),
            originalCount:
              'countedAt' in state &&
              state.countedAt === original.state.countedAt,
            requests: after.requests,
            tokens: after.input_tokens,
            outcome,
          },
          expected: {
            restorations: 1,
            stateStable: true,
            sourceStable: true,
            originalCount: true,
            requests: 1,
            tokens: provider === 'received' ? 7 : 0,
            outcome:
              provider === 'received'
                ? 'delivered'
                : provider === 'failed'
                  ? 'definite_failure'
                  : 'unknown',
          },
        });
      },
    );
  });
}
