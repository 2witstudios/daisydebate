import { createId } from '@paralleldrive/cuid2';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  at,
  columnNames,
  indexDefinition,
  rejected,
  withFixture,
} from './constraint-helpers';
import { requireTestServices } from '@daisy/config';

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);

describe('rounds (DATA-2.1)', () => {
  test('created_by points at actors and the vocabularies are closed', async () => {
    await withFixture(url, async (fixture) => {
      const userId = await fixture.user();
      const actorId = await fixture.actor(userId);
      const byUser = await rejected(() =>
        fixture.round({ created_by_actor_id: userId }),
      );
      const byUnknownActor = await rejected(() =>
        fixture.round({ created_by_actor_id: createId() }),
      );
      const byActor = !(await rejected(() =>
        fixture.round({ created_by_actor_id: actorId }),
      ));
      const actorDeleteBlocked = await rejected(() =>
        fixture.sql.unsafe('delete from actors where id = $1', [actorId]),
      );
      const badCompetitionType = await rejected(() =>
        fixture.round({ competition_type: 'friendly' }),
      );
      const quickLength = !(await rejected(() =>
        fixture.round({ length: 'quick' }),
      ));
      const badLength = await rejected(() =>
        fixture.round({ length: 'extended' }),
      );
      const badOutcome = await rejected(() =>
        fixture.round({
          status: 'completed',
          current_stage: null,
          started_at: at,
          completed_at: at,
          outcome: 'tie',
        }),
      );
      assert({
        given:
          'rounds authored by a user id, an unknown actor and a real actor',
        should:
          'accept only the actor, keep it undeletable, accept the quick length and reject values outside each vocabulary',
        actual: {
          byUser,
          byUnknownActor,
          byActor,
          actorDeleteBlocked,
          badCompetitionType,
          quickLength,
          badLength,
          badOutcome,
        },
        expected: {
          byUser: true,
          byUnknownActor: true,
          byActor: true,
          actorDeleteBlocked: true,
          badCompetitionType: true,
          quickLength: true,
          badLength: true,
          badOutcome: true,
        },
      });
    });
  });

  test('the lifecycle CHECK keeps status and its projections coherent', async () => {
    await withFixture(url, async (fixture) => {
      const attempt = (row: Record<string, unknown>) =>
        rejected(() => fixture.round(row));
      const outcomes = {
        activeWithoutStage: await attempt({
          status: 'active',
          started_at: at,
        }),
        activeWithoutStart: await attempt({
          status: 'active',
          current_stage: 'countdown',
        }),
        activeWithOutcome: await attempt({
          status: 'active',
          current_stage: 'countdown',
          started_at: at,
          outcome: 'draw',
        }),
        activeWithCompletion: await attempt({
          status: 'active',
          current_stage: 'countdown',
          started_at: at,
          completed_at: at,
        }),
        activeFull: !(await attempt({
          status: 'active',
          current_stage: 'countdown',
          started_at: at,
        })),
        completedWithoutOutcome: await attempt({
          status: 'completed',
          started_at: at,
          completed_at: at,
        }),
        completedWithoutCompletedAt: await attempt({
          status: 'completed',
          started_at: at,
          outcome: 'negative',
        }),
        completedFull: !(await attempt({
          status: 'completed',
          started_at: at,
          completed_at: at,
          outcome: 'affirmative',
        })),
        completedNeverStarted: await attempt({
          status: 'completed',
          completed_at: at,
          outcome: 'affirmative',
        }),
        // Abandonment is lifecycle, not outcome: it deliberately leaves
        // started_at nullable so a round abandoned before starting is
        // representable (ADR 0058 §8).
        abandonedNeverStarted: !(await attempt({
          status: 'abandoned',
          completed_at: at,
        })),
        abandonedNeverCompleted: await attempt({ status: 'abandoned' }),
        abandonedWithOutcome: await attempt({
          status: 'abandoned',
          completed_at: at,
          outcome: 'affirmative',
        }),
        scheduledWithStart: await attempt({
          status: 'scheduled',
          started_at: at,
        }),
        scheduledWithStage: await attempt({
          status: 'scheduled',
          current_stage: 'live',
        }),
        unknownStatus: await attempt({ status: 'paused' }),
        unknownStage: await attempt({
          status: 'active',
          current_stage: 'speaking',
          started_at: at,
        }),
      };
      assert({
        given: 'every status combined with its stage, timestamps and outcome',
        should:
          'accept only coherent rows, including abandoned-before-start, and reject the rest',
        actual: outcomes,
        expected: {
          activeWithoutStage: true,
          activeWithoutStart: true,
          activeWithOutcome: true,
          activeWithCompletion: true,
          activeFull: true,
          completedWithoutOutcome: true,
          completedWithoutCompletedAt: true,
          completedFull: true,
          completedNeverStarted: true,
          abandonedNeverStarted: true,
          abandonedNeverCompleted: true,
          abandonedWithOutcome: true,
          scheduledWithStart: true,
          scheduledWithStage: true,
          unknownStatus: true,
          unknownStage: true,
        },
      });
    });
  });

  test('carries the queryable indexes', async () => {
    await withFixture(url, async (fixture) => {
      assert({
        given: 'the rounds table',
        should:
          'index (status, competition_type, created_at) and (format_id, completed_at)',
        actual: [
          await indexDefinition(
            fixture,
            'rounds_status_competition_created_idx',
          ),
          await indexDefinition(fixture, 'rounds_format_completed_idx'),
        ].map((definition) => definition?.replace(/.* USING btree /, '')),
        expected: [
          '(status, competition_type, created_at)',
          '(format_id, completed_at)',
        ],
      });
    });
  });
});

describe('round participants (DATA-2.2)', () => {
  test('one actor per round, one actor per seat, roles from the vocabulary', async () => {
    await withFixture(url, async (fixture) => {
      const roundId = await fixture.round();
      const actorId = await fixture.actor();
      await fixture.participant(roundId, 'affirmative', 0, actorId);
      const seatTaken = await rejected(() =>
        fixture.participant(roundId, 'affirmative', 0),
      );
      const actorTwice = await rejected(() =>
        fixture.participant(roundId, 'negative', 0, actorId),
      );
      const secondSlot = !(await rejected(() =>
        fixture.participant(roundId, 'affirmative', 1),
      ));
      const spectator = await rejected(() =>
        fixture.participant(roundId, 'spectator', 0),
      );
      const negativeSlot = await rejected(() =>
        fixture.participant(roundId, 'negative', -1),
      );
      const unknownActor = await fixture.rejects('round_participants', {
        id: createId(),
        round_id: roundId,
        actor_id: createId(),
        role: 'negative',
        slot: 0,
      });
      const unknownRound = await fixture.rejects('round_participants', {
        id: createId(),
        round_id: createId(),
        actor_id: await fixture.actor(),
        role: 'negative',
        slot: 0,
      });
      assert({
        given: 'a round with one affirmative seat',
        should:
          'reject the same seat, the same actor, a role outside the vocabulary, a negative slot and an unknown actor or round; accept a second slot',
        actual: {
          seatTaken,
          actorTwice,
          secondSlot,
          spectator,
          negativeSlot,
          unknownActor,
          unknownRound,
        },
        expected: {
          seatTaken: true,
          actorTwice: true,
          secondSlot: true,
          spectator: true,
          negativeSlot: true,
          unknownActor: true,
          unknownRound: true,
        },
      });
    });
  });

  test('stores no derived result and indexes an actor history', async () => {
    await withFixture(url, async (fixture) => {
      assert({
        given: 'the round_participants table',
        should: 'have no result column and an actor history index',
        actual: {
          hasResult: (await columnNames(fixture, 'round_participants')).some(
            (column) => column.includes('result'),
          ),
          history: (
            await indexDefinition(fixture, 'round_participants_actor_idx')
          )?.includes('(actor_id)'),
        },
        expected: { hasResult: false, history: true },
      });
    });
  });
});
