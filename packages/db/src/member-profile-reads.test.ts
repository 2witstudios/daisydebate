import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createTestDatabase } from './index.test-support';
import type { HistoryScope } from './member-profile-reads';

setupRitewayBun();

const at = new Date('2026-10-05T12:00:00.000Z');
const earlier = new Date('2026-10-04T12:00:00.000Z');
const userId = 'u'.repeat(24);
const actorId = 'a'.repeat(24);
const caller = { userId: 'v'.repeat(24), actorId: 'b'.repeat(24) };
const account = {
  userId: caller.userId,
  actorId: caller.actorId,
  member: true,
  erased: false,
  revision: 3,
};
const memberRow = [userId, actorId, 'debater-a', at];

/** A decision that records what it was asked and answers `scope`. */
const deciding = (scope: HistoryScope) => {
  const asked: unknown[] = [];
  return {
    asked,
    decide: (memberActorId: string, fact: unknown) => {
      asked.push([memberActorId, fact]);
      return scope;
    },
  };
};

const read = (
  database: ReturnType<typeof createTestDatabase>['database'],
  input: {
    readonly caller: typeof caller | null;
    readonly decide: (memberActorId: string, fact: unknown) => HistoryScope;
    readonly before?: string;
    readonly limit?: number;
  },
) =>
  database.readMemberProfile({
    username: 'Debater-A',
    caller: input.caller,
    decide: input.decide,
    before: input.before ?? null,
    limit: input.limit ?? 1,
  });

describe('readMemberProfile', () => {
  test('a signed-in viewer, one page of two', async () => {
    const { decide, asked } = deciding('public');
    const { database, queries } = createTestDatabase([
      // The snapshot statement, the member, then the fresh account fact.
      [],
      [memberRow],
      [account],
      [['completed', 'affirmative', 'affirmative', 2]],
      [
        ['round-2', at, 'Motion two', 'public', 'negative', 'affirmative'],
        ['round-1', earlier, 'Motion one', 'public', null, 'negative'],
      ],
      [
        ['round-2', 'affirmative', 'human', 'debater-a', null],
        ['round-2', 'judge', 'bot', null, 'Judge bot'],
        ['round-2', 'negative', 'human', null, null],
      ],
      [['round-2']],
      [],
    ]);
    const profile = await read(database, { caller, decide });
    assert({
      given: 'a member with two Rounds read by another signed-in member',
      should:
        'decide the scope on the fresh account, then read the public tally and one page with its forfeit',
      actual: {
        asked,
        fenced: /daisy_room_read_account/.test(queries[2]?.query ?? ''),
        publicTally: /"visibility" = \$/.test(queries[3]?.query ?? ''),
        profile,
      },
      expected: {
        asked: [[actorId, account]],
        fenced: true,
        publicTally: true,
        profile: {
          member: {
            userId,
            actorId,
            username: 'debater-a',
            memberSince: at.toISOString(),
          },
          scope: 'public',
          groups: [
            {
              status: 'completed',
              outcome: 'affirmative',
              role: 'affirmative',
              rounds: 2,
            },
          ],
          rows: [
            {
              roundId: 'round-2',
              completedAt: at.toISOString(),
              resolution: 'Motion two',
              visibility: 'public',
              outcome: 'negative',
              role: 'affirmative',
              forfeit: true,
              seats: [
                { role: 'affirmative', kind: 'human', label: 'debater-a' },
                { role: 'judge', kind: 'bot', label: 'Judge bot' },
                { role: 'negative', kind: 'human', label: null },
              ],
            },
          ],
          nextBefore: 'round-2',
        },
      },
    });
  });

  test('a visitor, and the owner’s scope', async () => {
    const visitor = deciding('public');
    const empty = createTestDatabase([[], [memberRow], [], []]);
    const owner = deciding('owner');
    const own = createTestDatabase([
      [],
      [memberRow],
      [account],
      [],
      [['round-3', at, 'Motion three', null, null, 'negative']],
      [],
      [],
      [],
    ]);
    const visitorRead = await read(empty.database, {
      caller: null,
      decide: visitor.decide,
    });
    const ownRead = await read(own.database, {
      caller,
      decide: owner.decide,
    });
    assert({
      given:
        'a visitor with no account to read, and an owner scope over a room Round with no visibility',
      should:
        'decide without an account and skip seat reads for an empty page; read every Round for the owner, null visibility as private',
      actual: [
        visitor.asked,
        visitorRead?.rows,
        empty.queries.length,
        /"visibility" = \$/.test(own.queries[3]?.query ?? ''),
        ownRead?.rows[0]?.visibility,
      ],
      expected: [[[actorId, null]], [], 4, false, 'private'],
    });
  });

  test('no member, and an older page', async () => {
    const nobody = createTestDatabase([[], []]);
    const older = createTestDatabase([[], [memberRow], [], [['round-2']], []]);
    const { decide } = deciding('public');
    assert({
      given: 'a name no live member holds, then a cursor naming a listed Round',
      should:
        'answer null without deciding, then compare (completed_at, id) in SQL against that Round',
      actual: [
        await read(nobody.database, { caller: null, decide }),
        (
          await read(older.database, {
            caller: null,
            decide,
            before: 'round-2',
            limit: 20,
          })
        )?.nextBefore,
        /\("rounds"\."completed_at", "rounds"\."id"\) < \(select c\.completed_at, c\.id from rounds c/.test(
          older.queries[4]?.query ?? '',
        ),
      ],
      expected: [null, null, true],
    });
  });

  test('refused reads', async () => {
    const { decide } = deciding('public');
    const { database } = createTestDatabase([[], [memberRow], [], []]);
    await assertRejects({
      given: 'a cursor naming a Round outside the scope’s list',
      should: 'refuse it as invalid',
      actual: () =>
        read(database, { caller: null, decide, before: 'round-9', limit: 20 }),
      code: 'VALIDATION',
    });
    for (const limit of [0, 51, 1.5])
      await assertRejects({
        given: `a page size of ${limit}`,
        should: 'refuse it before any read',
        actual: () => read(database, { caller: null, decide, limit }),
        code: 'VALIDATION',
      });
  });
});
