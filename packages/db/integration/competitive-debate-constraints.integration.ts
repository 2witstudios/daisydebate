import { createId } from '@paralleldrive/cuid2';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  at,
  columnNames,
  indexDefinition,
  rejected,
  withFixture,
} from './constraint-helpers';

setupRitewayBun();

const url = process.env.TEST_DATABASE_URL;
if (!url)
  throw new Error(
    'TEST_DATABASE_URL required; never use application database for tests',
  );
if (!new URL(url).pathname.endsWith('_test'))
  throw new Error('Test database name must end in _test');

describe('debates (DATA-2.1)', () => {
  test('created_by points at actors and the vocabularies are closed', async () => {
    await withFixture(url, async (fixture) => {
      const userId = await fixture.user();
      const actorId = await fixture.actor(userId);
      const byUser = await rejected(() =>
        fixture.debate({ created_by_actor_id: userId }),
      );
      const byUnknownActor = await rejected(() =>
        fixture.debate({ created_by_actor_id: createId() }),
      );
      const byActor = !(await rejected(() =>
        fixture.debate({ created_by_actor_id: actorId }),
      ));
      const actorDeleteBlocked = await rejected(() =>
        fixture.sql.unsafe('delete from actors where id = $1', [actorId]),
      );
      const badMode = await rejected(() =>
        fixture.debate({ mode: 'friendly' }),
      );
      const badVisibility = await rejected(() =>
        fixture.debate({ visibility: 'secret' }),
      );
      const badOutcome = await rejected(() =>
        fixture.debate({
          phase: 'completed',
          started_at: at,
          completed_at: at,
          outcome: 'tie',
        }),
      );
      assert({
        given:
          'debates authored by a user id, an unknown actor and a real actor',
        should:
          'accept only the actor, keep it undeletable, and reject values outside each vocabulary',
        actual: {
          byUser,
          byUnknownActor,
          byActor,
          actorDeleteBlocked,
          badMode,
          badVisibility,
          badOutcome,
        },
        expected: {
          byUser: true,
          byUnknownActor: true,
          byActor: true,
          actorDeleteBlocked: true,
          badMode: true,
          badVisibility: true,
          badOutcome: true,
        },
      });
    });
  });

  test('the lifecycle CHECK keeps phase and its projections coherent', async () => {
    await withFixture(url, async (fixture) => {
      const attempt = (row: Record<string, unknown>) =>
        rejected(() => fixture.debate(row));
      const outcomes = {
        activeWithoutStart: await attempt({ phase: 'active' }),
        activeWithStart: !(await attempt({ phase: 'active', started_at: at })),
        activeWithOutcome: await attempt({
          phase: 'active',
          started_at: at,
          outcome: 'draw',
        }),
        completedWithoutOutcome: await attempt({
          phase: 'completed',
          started_at: at,
          completed_at: at,
        }),
        completedWithoutCompletedAt: await attempt({
          phase: 'completed',
          started_at: at,
          outcome: 'negative',
        }),
        completedFull: !(await attempt({
          phase: 'completed',
          started_at: at,
          completed_at: at,
          outcome: 'affirmative',
        })),
        completedNeverStarted: await attempt({
          phase: 'completed',
          completed_at: at,
          outcome: 'affirmative',
        }),
        abandonedNeverStarted: !(await attempt({
          phase: 'completed',
          completed_at: at,
          outcome: 'abandoned',
        })),
        waitingWithStart: await attempt({ phase: 'waiting', started_at: at }),
        waitingWithCompletion: await attempt({
          phase: 'waiting',
          completed_at: at,
        }),
        waitingWithOutcome: await attempt({
          phase: 'waiting',
          outcome: 'draw',
        }),
        unknownPhase: await attempt({ phase: 'paused' }),
      };
      assert({
        given: 'every phase combined with started_at, completed_at and outcome',
        should:
          'accept only coherent rows, including abandoned-before-start, and reject the rest',
        actual: outcomes,
        expected: {
          activeWithoutStart: true,
          activeWithStart: true,
          activeWithOutcome: true,
          completedWithoutOutcome: true,
          completedWithoutCompletedAt: true,
          completedFull: true,
          completedNeverStarted: true,
          abandonedNeverStarted: true,
          waitingWithStart: true,
          waitingWithCompletion: true,
          waitingWithOutcome: true,
          unknownPhase: true,
        },
      });
    });
  });

  test('carries the queryable indexes', async () => {
    await withFixture(url, async (fixture) => {
      assert({
        given: 'the debates table',
        should: 'index (phase, mode, created_at) and (format_id, completed_at)',
        actual: [
          await indexDefinition(fixture, 'debates_phase_mode_created_idx'),
          await indexDefinition(fixture, 'debates_format_completed_idx'),
        ].map((definition) => definition?.replace(/.* USING btree /, '')),
        expected: ['(phase, mode, created_at)', '(format_id, completed_at)'],
      });
    });
  });
});

describe('debate participants (DATA-2.2)', () => {
  test('one actor per debate, one actor per seat, roles from the vocabulary', async () => {
    await withFixture(url, async (fixture) => {
      const debateId = await fixture.debate();
      const actorId = await fixture.actor();
      await fixture.participant(debateId, 'affirmative', 0, actorId);
      const seatTaken = await rejected(() =>
        fixture.participant(debateId, 'affirmative', 0),
      );
      const actorTwice = await rejected(() =>
        fixture.participant(debateId, 'negative', 0, actorId),
      );
      const secondSlot = !(await rejected(() =>
        fixture.participant(debateId, 'affirmative', 1),
      ));
      const judge = !(await rejected(() =>
        fixture.participant(debateId, 'judge', 0),
      ));
      const spectator = await rejected(() =>
        fixture.participant(debateId, 'spectator', 0),
      );
      const negativeSlot = await rejected(() =>
        fixture.participant(debateId, 'negative', -1),
      );
      const badStatus = await fixture.rejects('debate_participants', {
        debate_id: debateId,
        actor_id: await fixture.actor(),
        role: 'negative',
        slot: 0,
        status: 'kicked',
        joined_at: at,
      });
      const unknownActor = await fixture.rejects('debate_participants', {
        debate_id: debateId,
        actor_id: createId(),
        role: 'negative',
        slot: 0,
        status: 'joined',
        joined_at: at,
      });
      assert({
        given: 'a debate with one affirmative participant',
        should:
          'reject the same seat, the same actor, a role or status outside the vocabulary, a negative slot and an unknown actor; accept a second slot and a judge',
        actual: {
          seatTaken,
          actorTwice,
          secondSlot,
          judge,
          spectator,
          negativeSlot,
          badStatus,
          unknownActor,
        },
        expected: {
          seatTaken: true,
          actorTwice: true,
          secondSlot: true,
          judge: true,
          spectator: true,
          negativeSlot: true,
          badStatus: true,
          unknownActor: true,
        },
      });
    });
  });

  test('stores no derived result and indexes an actor history', async () => {
    await withFixture(url, async (fixture) => {
      assert({
        given: 'the participants table',
        should:
          'have no result column and a descending joined_at history index',
        actual: {
          hasResult: (await columnNames(fixture, 'debate_participants')).some(
            (column) => column.includes('result'),
          ),
          history: (
            await indexDefinition(
              fixture,
              'debate_participants_actor_joined_idx',
            )
          )?.includes('(actor_id, joined_at DESC'),
        },
        expected: { hasResult: false, history: true },
      });
    });
  });
});
