import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createDatabase } from '../src';
import { createTestOnlyOperations } from '../src/test-only-operations';
import { snapshotFor } from './constraint-helpers';

setupRitewayBun();

const url = process.env.TEST_DATABASE_URL;
if (!url)
  throw new Error(
    'TEST_DATABASE_URL required; never use application database for tests',
  );
if (!new URL(url).pathname.endsWith('_test'))
  throw new Error('Test database name must end in _test');

const snapshotOf = (
  id: string,
  phase: 'waiting' | 'active' | 'completed',
  participants: ReadonlyArray<{
    id: string;
    side: 'affirmative' | 'negative';
    ready: boolean;
  }>,
) => snapshotFor(id, { phase, participants });

/**
 * ISSUE-6: `debate_participants` is a projection of the snapshot's
 * `participants` (ADR 0029: snapshot participant ids are actor ids), so it
 * is written in the same transaction as every snapshot write and always
 * equals the snapshot's seats.
 */
test('debate_participants is written in the snapshot transaction and always equals the snapshot seats', async () => {
  const fixture = new SQL(url, { max: 1 });
  const database = createDatabase({ url, nextActorId: createId });
  const testOnly = createTestOnlyOperations({ client: fixture });
  const debateId = createId();
  const users = [createId(), createId()];
  const [first, second] = [createId(), createId()];
  const seats = () => fixture`
    select actor_id, role, slot, status
    from debate_participants where debate_id = ${debateId}
    order by role
  `;
  try {
    for (const [index, actorId] of [first, second].entries()) {
      await fixture`insert into users (id) values (${users[index]})`;
      await fixture`insert into actors (id, kind, user_id) values (${actorId}, 'human', ${users[index]})`;
    }
    await database.createDebate({
      id: debateId,
      createdBy: null,
      resolution: 'integration proof',
      format: 'foundation',
      snapshot: snapshotOf(debateId, 'waiting', [
        { id: first!, side: 'affirmative', ready: false },
      ]),
      mode: 'casual',
      visibility: 'unlisted',
    });
    const afterCreate = await seats();
    await testOnly.saveSnapshot({
      id: debateId,
      expectedVersion: 1,
      snapshot: snapshotOf(debateId, 'waiting', [
        { id: first!, side: 'affirmative', ready: true },
        { id: second!, side: 'negative', ready: false },
      ]),
      updatedAt: '2026-01-01T00:01:00.000Z',
    });
    const afterJoin = await seats();
    await testOnly.saveSnapshot({
      id: debateId,
      expectedVersion: 2,
      snapshot: snapshotOf(debateId, 'waiting', [
        { id: second!, side: 'negative', ready: true },
      ]),
      updatedAt: '2026-01-01T00:02:00.000Z',
    });
    const afterLeave = await seats();
    assert({
      given: 'a debate created, joined and left through snapshot writes',
      should: 'hold exactly the snapshot participants after every write',
      actual: { afterCreate, afterJoin, afterLeave },
      expected: {
        afterCreate: [
          { actor_id: first, role: 'affirmative', slot: 0, status: 'joined' },
        ],
        afterJoin: [
          { actor_id: first, role: 'affirmative', slot: 0, status: 'ready' },
          { actor_id: second, role: 'negative', slot: 0, status: 'joined' },
        ],
        afterLeave: [
          { actor_id: second, role: 'negative', slot: 0, status: 'ready' },
        ],
      },
    });

    const version = await (async () => {
      try {
        await testOnly.saveSnapshot({
          id: debateId,
          expectedVersion: 3,
          snapshot: snapshotOf(debateId, 'waiting', [
            { id: createId(), side: 'affirmative', ready: false },
          ]),
          updatedAt: '2026-01-01T00:03:00.000Z',
        });
        return 'saved';
      } catch {
        const [row] =
          await fixture`select version from debates where id = ${debateId}`;
        return row?.version;
      }
    })();
    assert({
      given: 'a snapshot naming a participant that is not an actor',
      should:
        'refuse the whole write, leaving the snapshot version and seats unchanged',
      actual: { version, seats: await seats() },
      expected: { version: 3, seats: afterLeave },
    });
  } finally {
    await database.close();
    await fixture`delete from debates where id = ${debateId}`;
    await fixture`delete from actors where id in ${fixture([first!, second!])}`;
    await fixture`delete from users where id in ${fixture(users)}`;
    await fixture.close();
  }
});

/**
 * ISSUE-43: the snapshot owns only the debater seats (its `participants`
 * carry `affirmative`/`negative` sides). A judge seat is written by the
 * judging path, and `ballots` cascade from it, so a snapshot write that
 * deleted every seat it does not name would wipe judges and their ballots on
 * any write, even a ready toggle.
 */
test('a snapshot write never touches a judge seat or its ballot', async () => {
  const fixture = new SQL(url, { max: 1 });
  const database = createDatabase({ url, nextActorId: createId });
  const testOnly = createTestOnlyOperations({ client: fixture });
  const debateId = createId();
  const users = [createId(), createId(), createId()];
  const [debater, other, judge] = [createId(), createId(), createId()];
  const ballots = () => fixture`
    select id, judge_actor_id, decision, status, version
    from ballots where debate_id = ${debateId}
  `;
  const judgeSeat = () => fixture`
    select role, slot, status, joined_at, version
    from debate_participants where debate_id = ${debateId} and role = 'judge'
  `;
  try {
    for (const [index, actorId] of [debater, other, judge].entries()) {
      await fixture`insert into users (id) values (${users[index]})`;
      await fixture`insert into actors (id, kind, user_id) values (${actorId}, 'human', ${users[index]})`;
    }
    await database.createDebate({
      id: debateId,
      createdBy: null,
      resolution: 'integration proof',
      format: 'foundation',
      snapshot: snapshotOf(debateId, 'waiting', [
        { id: debater!, side: 'affirmative', ready: false },
      ]),
      mode: 'casual',
      visibility: 'unlisted',
    });
    await fixture`
      insert into debate_participants (debate_id, actor_id, role, slot, status, joined_at)
      values (${debateId}, ${judge}, 'judge', 0, 'joined', now())
    `;
    await fixture`
      insert into ballots (id, debate_id, judge_actor_id, decision, scores, reason, status, submitted_at)
      values (${createId()}, ${debateId}, ${judge}, 'affirmative', '{}'::jsonb, 'probe', 'submitted', now())
    `;
    const ballotsBefore = await ballots();
    const seatBefore = await judgeSeat();
    // The reviewer's probe: a ready toggle.
    await testOnly.saveSnapshot({
      id: debateId,
      expectedVersion: 1,
      snapshot: snapshotOf(debateId, 'waiting', [
        { id: debater!, side: 'affirmative', ready: true },
      ]),
      updatedAt: '2026-01-01T00:01:00.000Z',
    });
    const afterToggle = { ballots: await ballots(), seat: await judgeSeat() };
    // A join and a leave rewrite the debater seats around the judge.
    await testOnly.saveSnapshot({
      id: debateId,
      expectedVersion: 2,
      snapshot: snapshotOf(debateId, 'waiting', [
        { id: debater!, side: 'affirmative', ready: true },
        { id: other!, side: 'negative', ready: false },
      ]),
      updatedAt: '2026-01-01T00:02:00.000Z',
    });
    await testOnly.saveSnapshot({
      id: debateId,
      expectedVersion: 3,
      snapshot: snapshotOf(debateId, 'waiting', []),
      updatedAt: '2026-01-01T00:03:00.000Z',
    });
    const afterLeave = { ballots: await ballots(), seat: await judgeSeat() };
    assert({
      given:
        'a judge seat with a submitted ballot, then a ready toggle, a join and every debater leaving',
      should:
        'leave the judge seat and its ballot exactly as they were after every snapshot write',
      actual: { afterToggle, afterLeave, submitted: ballotsBefore.length },
      expected: {
        afterToggle: { ballots: ballotsBefore, seat: seatBefore },
        afterLeave: { ballots: ballotsBefore, seat: seatBefore },
        submitted: 1,
      },
    });

    const refused = await testOnly
      .saveSnapshot({
        id: debateId,
        expectedVersion: 4,
        snapshot: snapshotOf(debateId, 'waiting', [
          { id: judge!, side: 'affirmative', ready: false },
        ]),
        updatedAt: '2026-01-01T00:04:00.000Z',
      })
      .then(() => 'saved')
      .catch(() => 'refused');
    const [{ version } = {}] =
      await fixture`select version from debates where id = ${debateId}`;
    assert({
      given: 'a snapshot that seats the debate’s judge as a debater',
      should:
        'refuse the whole write, leaving the judge seat, its ballot and the snapshot version unchanged',
      actual: {
        refused,
        version,
        ballots: await ballots(),
        seat: await judgeSeat(),
      },
      expected: {
        refused: 'refused',
        version: 4,
        ballots: ballotsBefore,
        seat: seatBefore,
      },
    });
  } finally {
    await database.close();
    await fixture`delete from debates where id = ${debateId}`;
    await fixture`delete from actors where id in ${fixture([debater!, other!, judge!])}`;
    await fixture`delete from users where id in ${fixture(users)}`;
    await fixture.close();
  }
});

/**
 * ISSUE-37 (ADR 0033 §3.2): every competitive time is PostgreSQL time. The
 * caller's `updatedAt` here is 2001, far from the database clock, so a
 * stamp that followed the caller would land in 2001.
 */
test('started_at, completed_at and joined_at follow the database clock, never the caller', async () => {
  const fixture = new SQL(url, { max: 1 });
  const database = createDatabase({ url, nextActorId: createId });
  const testOnly = createTestOnlyOperations({ client: fixture });
  const debateId = createId();
  const users = [createId(), createId()];
  const [first, second] = [createId(), createId()];
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
    for (const [index, actorId] of [first, second].entries()) {
      await fixture`insert into users (id) values (${users[index]})`;
      await fixture`insert into actors (id, kind, user_id) values (${actorId}, 'human', ${users[index]})`;
    }
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
    await database.close();
    await fixture`delete from debates where id = ${debateId}`;
    await fixture`delete from actors where id in ${fixture([first!, second!])}`;
    await fixture`delete from users where id in ${fixture(users)}`;
    await fixture.close();
  }
});
