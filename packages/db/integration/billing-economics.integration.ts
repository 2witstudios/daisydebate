import { SQL } from 'bun';
import { sql } from 'drizzle-orm';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { createDatabase } from '../src/index';
import { createBoundedTransaction } from '../src/bounded-transaction';
import { createLane } from '../src/workload';
import { createBillingEconomicsReader } from '../src/billing-economics';
import { withFixture } from './constraint-helpers';

const { databaseUrl } = requireTestServices(process.env);
setupRitewayBun();

test('real bounded current-service aggregate preserves original source/period and paid provider expense after usage restoration', async () =>
  withFixture(databaseUrl, async (fixture) => {
    const pool = new SQL(databaseUrl, { max: 6 });
    const instanceId = createId();
    const db = createDatabase({
      url: databaseUrl,
      client: pool,
      nextActorId: createId,
    });
    const run = createBoundedTransaction({
      lane: createLane('control', pool, {
        connections: 6,
        queue: 16,
        maxWaitMs: 1000,
      }),
      now: performance.now,
    });
    const reader = createBillingEconomicsReader({ run, instanceId });
    try {
      const window = {
        startsAt: '2026-10-01T00:00:00.000Z',
        endsAt: '2026-11-01T00:00:00.000Z',
      };
      await assertRejects({
        given: 'no current service identity',
        should: 'refuse the private aggregate reader',
        actual: () => reader.read(window),
        code: 'AUTHORIZATION',
      });
      const userId = await fixture.user(),
        actorId = await fixture.actor(userId);
      const round = await fixture.round({ created_by_actor_id: actorId });
      const seat = await fixture.seat(round, 'affirmative', 0, actorId);
      const source = {
        kind: 'subscription',
        subscriptionId: createId(),
        startsAt: '2026-09-20T00:00:00.000Z',
        endsAt: '2026-10-20T00:00:00.000Z',
      };
      const state = {
        kind: 'refunded',
        countedAt: '2026-10-01T12:00:00.000Z',
        countBasis: 'dispatch_record',
        refundedAt: '2026-10-01T13:00:00.000Z',
      };
      await fixture.insert('usage_reservations', {
        id: createId(),
        actor_id: actorId,
        round_id: round,
        kind: 'ai_round',
        source,
        state,
        reserved_at: '2026-10-01T11:00:00.000Z',
      });
      for (const [model, outcome, input, output] of [
        ['actual-old-model', 'received', 100, 20],
        ['actual-old-model', 'received', 0, 0],
        ['positive-input-model', 'received', 200, 0],
        ['unanswered-model', 'unknown', 0, 0],
        ['zero-pair-model', 'received', 0, 0],
      ] as const)
        await fixture.insert('agent_runs', {
          id: createId(),
          round_participant_id: seat.id,
          kind: 'speech',
          model,
          provider: 'openrouter',
          configuration_snapshot: { providerOutcome: outcome },
          input_tokens: input,
          output_tokens: output,
          characters: 0,
          requests: 1,
          started_at: '2026-10-01T12:00:00.000Z',
        });
      // A process claim/default counter row has no dispatch witness and is not a measured zero call.
      await fixture.insert('agent_runs', {
        id: createId(),
        round_participant_id: seat.id,
        kind: 'speech',
        model: 'claim-only',
        provider: 'openrouter',
        configuration_snapshot: {},
        started_at: '2026-10-01T12:00:00.000Z',
      });
      await db.renewServiceInstance({ instanceId, role: 'web' });
      const reserve = pool.reserve.bind(pool);
      pool.reserve = async (options) => {
        const c = await reserve(options);
        await c`set role daisy_web`;
        return c;
      };
      const role = await run(
        async (tx) =>
          (await tx.execute(sql`select current_user as role`))[0]?.role,
      );
      const snapshot = await reader.read(window);
      assert({
        given:
          'real daisy_web projection of a refunded original subscription reservation and distinct known/unknown provider executions',
        should:
          'retain original source/period, served outcomes and positive totals while exposing solo and mixed unmeasured token pairs without participant identity or parent-claim zero cost',
        actual: [
          role,
          snapshot.complete,
          snapshot.attempts.map((a) => [
            a.model,
            a.sourceKind,
            a.sourceStartsAt,
            a.knownResponses,
            a.unmeasuredResponses,
            a.unknownCalls,
            a.inputTokens,
            a.outputTokens,
          ]),
          snapshot.usage.map((u) => [u.state, u.countBasis, u.reservations]),
          JSON.stringify(snapshot).includes(userId),
          JSON.stringify(snapshot).includes(actorId),
        ],
        expected: [
          'daisy_web',
          true,
          [
            [
              'actual-old-model',
              'subscription',
              source.startsAt,
              2,
              1,
              0,
              100,
              20,
            ],
            [
              'positive-input-model',
              'subscription',
              source.startsAt,
              1,
              0,
              0,
              200,
              0,
            ],
            [
              'unanswered-model',
              'subscription',
              source.startsAt,
              0,
              0,
              1,
              0,
              0,
            ],
            ['zero-pair-model', 'subscription', source.startsAt, 1, 1, 0, 0, 0],
          ],
          [['refunded', 'dispatch_record', 1]],
          false,
          false,
        ],
      });
      await fixture.sql`update service_instances set renewed_at=clock_timestamp()-interval '4 seconds' where instance_id=${instanceId}`;
      await assertRejects({
        given: 'a service that lost current authority',
        should: 'refuse further economics reads',
        actual: () => reader.read(window),
        code: 'AUTHORIZATION',
      });
    } finally {
      await pool.close({ timeout: 0 });
      await fixture.sql`delete from service_instances where instance_id=${instanceId}`;
    }
  }));
