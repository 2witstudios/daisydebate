import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createDatabase } from '../src';
import type { Database } from '../src';
import { createAuthorizationSubject } from './authorization.test-support';
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

/** The owner's scope only for the bound, current member themself. */
const ownerOnly = (
  memberActorId: string,
  account: {
    readonly actorId: string | null;
    readonly member: boolean;
    readonly erased: boolean;
  } | null,
) =>
  account !== null &&
  account.member &&
  !account.erased &&
  account.actorId === memberActorId
    ? ('owner' as const)
    : ('public' as const);

const profileOf = (
  database: Database,
  input: {
    readonly username: string;
    readonly caller: {
      readonly userId: string;
      readonly actorId: string;
    } | null;
    readonly before?: string | null;
    readonly limit?: number;
  },
) =>
  database.readMemberProfile({
    username: input.username,
    caller: input.caller,
    decide: ownerOnly,
    before: input.before ?? null,
    limit: input.limit ?? 10,
  });

/** A profile the test expects to exist. */
const present = async <T>(read: Promise<T | null>): Promise<T> => {
  const value = await read;
  if (value === null) throw new Error('Expected a member profile');
  return value;
};

const tally = (
  groups: readonly { role: string; outcome: string | null; rounds: number }[],
) => groups.map((g) => `${g.role}:${g.outcome}:${g.rounds}`).sort();

describe('member profile reads (ISSUE-600)', () => {
  test('reads a live member by name, case-insensitively, and nobody else', async () => {
    await withFixture(url, async (fixture) => {
      const database = createDatabase({ url, nextActorId: createId });
      try {
        const subject = await createAuthorizationSubject(fixture);
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
      } finally {
        await database.close();
      }
    });
  });

  test('scopes the tally by the fresh account: the owner counts every Round, anyone else the public ones', async () => {
    await withFixture(url, async (fixture) => {
      const database = createDatabase({ url, nextActorId: createId });
      try {
        const subject = await createAuthorizationSubject(fixture);
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
        const judged = await roomRound(fixture, {
          status: 'completed',
          outcome: 'negative',
          started_at: at(5, 11),
          completed_at: at(5),
        });
        await fixture.participant(judged, 'judge', 0, member);
        const proof = await fixture.round({
          status: 'completed',
          outcome: 'affirmative',
          started_at: at(6, 11),
          completed_at: at(6),
        });
        await fixture.participant(proof, 'affirmative', 0, member);
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
      } finally {
        await database.close();
      }
    });
  });

  test('pages completed Rounds newest first with opponents, forfeits and a stable cursor', async () => {
    await withFixture(url, async (fixture) => {
      const database = createDatabase({ url, nextActorId: createId });
      try {
        const subject = await createAuthorizationSubject(fixture);
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
            first.rows[0]?.seats.map((s) => [s.role, s.kind, s.label]),
            first.rows[1]?.seats.find((s) => s.role === 'judge'),
            first.rows.map((r) => [r.role, r.outcome, r.forfeit, r.visibility]),
          ],
          expected: [
            [
              ['affirmative', 'human', username],
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
          given: 'a visitor reading the same history',
          should: 'list only the public Rounds',
          actual: visitor.rows.map((r) => r.roundId),
          expected: [newest, oldest.id],
        });
        await assertRejects({
          given: 'a cursor naming a private Round to a visitor',
          should: 'refuse it as invalid',
          actual: () =>
            profileOf(database, { username, caller: null, before: middle.id }),
          code: 'VALIDATION',
        });
      } finally {
        await database.close();
      }
    });
  });
});
