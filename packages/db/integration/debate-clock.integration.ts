import { assert, setupRitewayBun, test } from 'riteway/bun';
import { seatedDebate, snapshotOf } from './constraint-helpers';
import { requireTestServices } from '@daisy/config';

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);

/**
 * ISSUE-37 (ADR 0033 §3.2): every competitive time is PostgreSQL time. The
 * caller's `updatedAt` here is 2001, far from the database clock, so a
 * stamp that followed the caller would land in 2001.
 */
test('started_at, completed_at and joined_at follow the database clock, never the caller', async () => {
  const {
    fixture,
    database,
    testOnly,
    debateId,
    actors: [first, second],
    cleanup,
  } = await seatedDebate(url, 2);
  const callerTime = '2001-01-01T00:00:00.000Z';
  const databaseNow = async () => {
    const [row] = await fixture`select statement_timestamp() as now`;
    return (row as { now: Date }).now.getTime();
  };
  const stamps = async () => {
    const [debate] = await fixture`
      select started_at, completed_at from debates where id = ${debateId}
    `;
    const seats = await fixture`
      select actor_id, joined_at from debate_participants
      where debate_id = ${debateId} order by role
    `;
    return { debate, seats } as {
      debate: { started_at: Date | null; completed_at: Date | null };
      seats: Array<{ actor_id: string; joined_at: Date }>;
    };
  };
  const within = (at: Date | null | undefined, from: number, to: number) =>
    at instanceof Date && at.getTime() >= from && at.getTime() <= to;
  try {
    const beforeCreate = await databaseNow();
    await database.createDebate({
      id: debateId,
      createdBy: null,
      resolution: 'integration proof',
      format: 'foundation',
      snapshot: snapshotOf(debateId, 'waiting', [
        { id: first!, side: 'affirmative', ready: true },
      ]),
      mode: 'casual',
      visibility: 'unlisted',
    });
    const afterCreate = await databaseNow();
    const created = await stamps();

    const beforeStart = await databaseNow();
    await testOnly.saveSnapshot({
      id: debateId,
      expectedVersion: 1,
      snapshot: snapshotOf(debateId, 'active', [
        { id: first!, side: 'affirmative', ready: true },
        { id: second!, side: 'negative', ready: true },
      ]),
      updatedAt: callerTime,
    });
    const afterStart = await databaseNow();
    const started = await stamps();

    const beforeComplete = await databaseNow();
    await testOnly.saveSnapshot({
      id: debateId,
      expectedVersion: 2,
      snapshot: snapshotOf(debateId, 'completed', [
        { id: first!, side: 'affirmative', ready: true },
        { id: second!, side: 'negative', ready: true },
      ]),
      updatedAt: callerTime,
      outcome: 'affirmative',
    });
    const afterComplete = await databaseNow();
    const completed = await stamps();
    const joinedAt = (
      snapshot: Awaited<ReturnType<typeof stamps>>,
      actorId: string,
    ) => snapshot.seats.find((seat) => seat.actor_id === actorId)?.joined_at;

    assert({
      given:
        'a debate created, started and completed with a caller time of 2001',
      should:
        'stamp each seat, the start and the completion with the database time of its own write, and never rewrite a seat’s joined_at',
      actual: {
        creatorJoined: within(
          joinedAt(created, first!),
          beforeCreate,
          afterCreate,
        ),
        joinerJoined: within(
          joinedAt(started, second!),
          beforeStart,
          afterStart,
        ),
        startedAt: within(started.debate.started_at, beforeStart, afterStart),
        completedAt: within(
          completed.debate.completed_at,
          beforeComplete,
          afterComplete,
        ),
        startKept:
          completed.debate.started_at?.getTime() ===
          started.debate.started_at?.getTime(),
        creatorKept:
          joinedAt(completed, first!)?.getTime() ===
          joinedAt(created, first!)?.getTime(),
      },
      expected: {
        creatorJoined: true,
        joinerJoined: true,
        startedAt: true,
        completedAt: true,
        startKept: true,
        creatorKept: true,
      },
    });
  } finally {
    await cleanup();
  }
});
