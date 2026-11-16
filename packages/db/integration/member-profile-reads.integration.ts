import { createId } from '@paralleldrive/cuid2';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createAuthorizationSubject } from './authorization.test-support';
import { createBotActor } from './bot-seat.test-support';
import {
  forfeitCommand,
  played,
  present,
  profileOf,
  roomRound,
  seatName,
  tally,
  winnerOf,
  withProfileFixture,
} from './member-profile.test-support';
import { at } from './standings-fixtures';

setupRitewayBun();

describe('member profile reads (ISSUE-600)', () => {
  test('reads a live member by name, case-insensitively, and nobody else', async () => {
    await withProfileFixture(async ({ database, subject }) => {
      const found = await profileOf(database, {
        username: subject.userId.toUpperCase(),
        caller: null,
      });
      assert({
        given: 'a live member named in upper case, read by a visitor',
        should: 'read their user, actor and name in the public scope',
        actual: [
          found?.member.userId,
          found?.member.actorId,
          found?.member.username,
          found?.scope,
        ],
        expected: [subject.userId, subject.actorId, subject.userId, 'public'],
      });
      assert({
        given: 'a name nobody holds',
        should: 'read nothing',
        actual: await profileOf(database, {
          username: `nobody-${createId()}`,
          caller: null,
        }),
        expected: null,
      });
    });
  });

  test('scopes the tally by the fresh account: the owner counts every Round, anyone else the public ones', async () => {
    await withProfileFixture(async ({ fixture, database, subject }) => {
      const member = subject.actorId;
      const other = await createAuthorizationSubject(fixture);
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
      await played(fixture, {
        member,
        side: 'affirmative',
        outcome: 'affirmative',
        day: 4,
        visibility: 'private',
      });
      await roomRound(
        fixture,
        {
          status: 'completed',
          winning_side: 'negative',
          started_at: at(5, 11),
          completed_at: at(5),
        },
        'public',
        [
          { seat: 'affirmative' },
          { seat: 'negative' },
          { seat: 'judge', actorId: member },
        ],
      );

      await fixture.roundWithCast(
        {
          status: 'completed',
          winning_side: 'affirmative',
          started_at: at(6, 11),
          completed_at: at(6),
        },
        [{ seat: 'affirmative', actorId: member }, { seat: 'negative' }],
      );
      const username = subject.userId;
      const owner = await profileOf(database, { username, caller: subject });
      const peer = await profileOf(database, { username, caller: other });
      const unbound = await profileOf(database, {
        username,
        caller: { userId: other.userId, actorId: member },
      });
      assert({
        given:
          'two public wins, a loss, an unjudged Round, a private win, a judge seat and a room-less service Round',
        should:
          'count the private win for the owner only, never the judge seat or the service Round, and give an unbound caller the public scope',
        actual: [
          owner?.scope,
          tally(owner?.groups ?? []),
          peer?.scope,
          tally(peer?.groups ?? []),
          unbound?.scope,
        ],
        expected: [
          'owner',
          [
            'affirmative:affirmative:2',
            'negative:affirmative:1',
            'negative:null:1',
          ],
          'public',
          [
            'affirmative:affirmative:1',
            'negative:affirmative:1',
            'negative:null:1',
          ],
          'public',
        ],
      });
    });
  });

  test('pages completed Rounds newest first with opponents, forfeits and a stable cursor', async () => {
    await withProfileFixture(async ({ fixture, database, subject }) => {
      const member = subject.actorId;
      const username = subject.userId;
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
        judgeActorId: (await createAuthorizationSubject(fixture)).actorId,
      });
      await forfeitCommand(fixture, middle.id, member);
      const bot = await createBotActor(fixture);
      const newest = await roomRound(
        fixture,
        {
          status: 'completed',
          winning_side: null,
          started_at: at(3, 11),
          completed_at: at(3),
        },
        'public',
        [
          { seat: 'affirmative', actorId: member },
          { seat: 'negative', actorId: bot },
        ],
      );
      await roomRound(
        fixture,
        {
          status: 'abandoned',
          completed_at: at(4),
        },
        'public',
        [{ seat: 'affirmative', actorId: member }, { seat: 'negative' }],
      );

      const first = await present(
        profileOf(database, {
          username,
          caller: subject,
          limit: 2,
        }),
      );
      const second = await present(
        profileOf(database, {
          username,
          caller: subject,
          before: first.nextBefore,
          limit: 2,
        }),
      );
      const visitor = await present(
        profileOf(database, { username, caller: null }),
      );
      assert({
        given:
          'three completed Rounds and an abandoned one, two to a page, read by the owner',
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
          'the newest Round against a bot, and the middle one the member forfeited before a human judge',
        should:
          'name the member and the bot opponent, never the judge, and mark only the forfeit',
        actual: [
          first.rows[0]?.seats.map((s) => [seatName(s.seat), s.kind, s.label]),
          first.rows[1]?.seats.find((s) => s.seat.kind === 'judge'),
          first.rows.map((r) => [
            seatName(r.seat),
            winnerOf(r.outcome),
            r.forfeit,
            r.visibility,
          ]),
        ],
        expected: [
          [
            ['affirmative', 'human', username],
            ['negative', 'bot', 'Fixture bot'],
          ],
          {
            seat: { kind: 'judge', slot: 0 },
            kind: 'human',
            label: null,
            closed: false,
          },
          [
            ['affirmative', null, false, 'public'],
            ['negative', 'affirmative', true, 'private'],
          ],
        ],
      });
      assert({
        given: 'a visitor reading the same history',
        should: 'list only the public Rounds',
        actual: visitor.rows.map((r) => r.roundId),
        expected: [newest, oldest.id],
      });
      assert({
        given: 'a cursor naming a private Round to a visitor',
        should: 'answer no page at all, so it cannot probe the Round',
        actual: await profileOf(database, {
          username,
          caller: null,
          before: middle.id,
        }),
        expected: null,
      });
    });
  });
});
