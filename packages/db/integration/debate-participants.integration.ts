import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { seatedDebate, snapshotOf } from './constraint-helpers';
import { requireTestServices } from '@daisy/config';

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);

/**
 * ISSUE-6: `debate_participants` is a projection of the snapshot's
 * `participants` (ADR 0029: snapshot participant ids are actor ids), so it
 * is written in the same transaction as every snapshot write and always
 * equals the snapshot's seats.
 */
test('debate_participants is written in the snapshot transaction and always equals the snapshot seats', async () => {
  const {
    fixture,
    database,
    testOnly,
    debateId,
    actors: [first, second],
    cleanup,
  } = await seatedDebate(url, 2);
  const seats = () => fixture`
    select actor_id, role, slot, status
    from debate_participants where debate_id = ${debateId}
    order by role
  `;
  try {
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
    await cleanup();
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
  const {
    fixture,
    database,
    testOnly,
    debateId,
    actors: [debater, other, judge],
    cleanup,
  } = await seatedDebate(url, 3);
  const ballots = () => fixture`
    select id, judge_actor_id, decision, status, version
    from ballots where debate_id = ${debateId}
  `;
  const judgeSeat = () => fixture`
    select role, slot, status, joined_at, version
    from debate_participants where debate_id = ${debateId} and role = 'judge'
  `;
  try {
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
    await cleanup();
  }
});
