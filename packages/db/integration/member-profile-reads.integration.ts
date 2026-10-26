import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createDatabase } from '../src';
import { createBotSeat } from './bot-seat.test-support';
import { withFixture } from './constraint-helpers';
import {
  forfeitCommand,
  played,
  roomRound,
} from './member-profile.test-support';
import { at } from './standings-fixtures';

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);

describe('member profile reads (ISSUE-600)', () => {
  test('reads a live member by name, case-insensitively', async () => {
    await withFixture(url, async (fixture) => {
      const database = createDatabase({ url, nextActorId: createId });
      try {
        const userId = await fixture.user();
        const actorId = await fixture.actor(userId);
        const username = `u-${userId}`;
        const found = await database.readMember(username.toUpperCase());
        assert({
          given: 'a live member named in upper case',
          should: 'read their user, actor and name',
          actual: [found?.userId, found?.actorId, found?.username],
          expected: [userId, actorId, username],
        });
        assert({
          given: 'a name nobody holds',
          should: 'read nothing',
          actual: await database.readMember(`nobody-${createId()}`),
          expected: null,
        });
      } finally {
        await database.close();
      }
    });
  });

  test('groups every debating seat for the record, and none of the judge seats', async () => {
    await withFixture(url, async (fixture) => {
      const database = createDatabase({ url, nextActorId: createId });
      try {
        const member = await fixture.actor();
        await played(fixture, {
          member,
          side: 'affirmative',
          outcome: 'affirmative',
          day: 1,
        });
        await played(fixture, {
          member,
          side: 'negative',
          outcome: 'affirmative',
          day: 2,
        });
        await played(fixture, {
          member,
          side: 'negative',
          outcome: null,
          day: 3,
        });
        const judged = await roomRound(fixture, {
          status: 'completed',
          outcome: 'negative',
          started_at: at(4, 11),
          completed_at: at(4),
        });
        await fixture.participant(judged, 'judge', 0, member);
        const groups = await database.readRecordGroups({
          actorId: member,
          publicOnly: false,
        });
        const proof = await fixture.round({
          status: 'completed',
          outcome: 'affirmative',
          started_at: at(5, 11),
          completed_at: at(5),
        });
        await fixture.participant(proof, 'affirmative', 0, member);
        const withProof = await database.readRecordGroups({
          actorId: member,
          publicOnly: false,
        });
        await played(fixture, {
          member,
          side: 'affirmative',
          outcome: 'affirmative',
          day: 6,
          visibility: 'private',
        });
        const publicGroups = await database.readRecordGroups({
          actorId: member,
          publicOnly: true,
        });
        assert({
          given:
            'a win, a loss and an unjudged Round as a debater, and one as a judge',
          should: 'group the three debating seats only',
          actual: groups
            .map((g) => `${g.role}:${g.outcome}:${g.rounds}`)
            .sort(),
          expected: [
            'affirmative:affirmative:1',
            'negative:affirmative:1',
            'negative:null:1',
          ],
        });
        assert({
          given: 'a room-less service Round, then a private win',
          should:
            'count neither the service Round nor, for anyone else, the private win',
          actual: [
            withProof.map((g) => `${g.role}:${g.outcome}:${g.rounds}`).sort(),
            publicGroups
              .map((g) => `${g.role}:${g.outcome}:${g.rounds}`)
              .sort(),
          ],
          expected: [
            [
              'affirmative:affirmative:1',
              'negative:affirmative:1',
              'negative:null:1',
            ],
            [
              'affirmative:affirmative:1',
              'negative:affirmative:1',
              'negative:null:1',
            ],
          ],
        });
      } finally {
        await database.close();
      }
    });
  });

  test('pages completed Rounds newest first with opponents, forfeits and a stable cursor', async () => {
    await withFixture(url, async (fixture) => {
      const database = createDatabase({ url, nextActorId: createId });
      try {
        const member = await fixture.actor();
        const oldest = await played(fixture, {
          member,
          side: 'affirmative',
          outcome: 'affirmative',
          day: 1,
        });
        const middle = await played(fixture, {
          member,
          side: 'negative',
          outcome: 'affirmative',
          day: 2,
          visibility: 'private',
        });
        await forfeitCommand(fixture, middle.id, member);
        await fixture.participant(middle.id, 'judge', 0);
        const newest = await roomRound(fixture, {
          status: 'completed',
          outcome: null,
          started_at: at(3, 11),
          completed_at: at(3),
        });
        await fixture.participant(newest, 'affirmative', 0, member);
        await createBotSeat(fixture, newest, 'negative');
        const abandoned = await roomRound(fixture, {
          status: 'abandoned',
          completed_at: at(4),
        });
        await fixture.participant(abandoned, 'affirmative', 0, member);

        const first = await database.readMatchHistory({
          actorId: member,
          publicOnly: false,
          before: null,
          limit: 2,
        });
        const second = await database.readMatchHistory({
          actorId: member,
          publicOnly: false,
          before: first.nextBefore,
          limit: 2,
        });
        const visitor = await database.readMatchHistory({
          actorId: member,
          publicOnly: true,
          before: null,
          limit: 10,
        });
        assert({
          given: 'three completed Rounds and an abandoned one, two to a page',
          should:
            'list the completed ones newest first across two pages, never the abandoned one',
          actual: [
            first.rows.map((r) => r.roundId),
            first.nextBefore,
            second.rows.map((r) => r.roundId),
            second.nextBefore,
          ],
          expected: [[newest, middle.id], middle.id, [oldest.id], null],
        });
        assert({
          given:
            'the newest Round against a bot and the middle one the member forfeited',
          should:
            'name the bot opponent, never the judge, and mark only the forfeit',
          actual: [
            first.rows[0]?.seats.map((s) => [s.role, s.kind, s.label]),
            first.rows[1]?.seats.find((s) => s.role === 'judge'),
            first.rows.map((r) => [r.role, r.outcome, r.forfeit, r.visibility]),
          ],
          expected: [
            [
              ['affirmative', 'human', first.rows[0]?.seats[0]?.label ?? null],
              ['negative', 'bot', 'Fixture bot'],
            ],
            { role: 'judge', kind: 'human', label: null },
            [
              ['affirmative', null, false, 'public'],
              ['negative', 'affirmative', true, 'private'],
            ],
          ],
        });
        assert({
          given: 'someone else reading the same history',
          should: 'list only the public Rounds',
          actual: visitor.rows.map((r) => r.roundId),
          expected: [newest, oldest.id],
        });
        await assertRejects({
          given: 'a cursor naming a private Round to a public reader',
          should: 'refuse it as invalid',
          actual: () =>
            database.readMatchHistory({
              actorId: member,
              publicOnly: true,
              before: middle.id,
              limit: 10,
            }),
          code: 'VALIDATION',
        });
      } finally {
        await database.close();
      }
    });
  });
});
