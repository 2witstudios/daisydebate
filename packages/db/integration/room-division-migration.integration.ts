import { afterAll } from 'bun:test';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { withFixture } from './constraint-helpers';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

const migration = '20261118233159_room_division';
const scratch = scratchDatabase(url, 'roomdivisionit');

afterAll(() => scratch.drop());

test(
  'the migration puts every Room in a lobby and every answered challenge in its Room’s (ADR 0156)',
  async () => {
    await scratch.create();
    await scratch.migrate((folder) => folder < migration);
    await withFixture(scratch.url, async (f) => {
      const aged = async (age: string | null) => {
        const user = await f.user();
        if (age !== null)
          await f.sql`insert into account_age(user_id, birth_month, version, recorded_at)
            values (${user}, to_char(now() - ${age}::interval, 'YYYY-MM'), 1, now() - interval '1 day')`;
        return f.actor(user);
      };
      const minor = await aged('15 years');
      const adult = await aged('30 years');
      const unknown = await aged(null);
      const format = await f.format();
      const minorRoom = await f.room(minor, format);
      const adultRoom = await f.room(adult, format);
      const unknownRoom = await f.room(unknown, format);
      const challenge = async (row: Record<string, unknown>) => {
        const id = createId();
        await f.insert('challenges', {
          id,
          challenger_actor_id: minor,
          challenged_actor_id: unknown,
          mode: 'casual',
          format_id: 'freestyle',
          created_at: new Date(),
          expires_at: new Date(Date.now() + 120_000),
          ...row,
        });
        return id;
      };
      try {
        const pendingCasual = await challenge({});
        const answeredCasual = await challenge({
          room_id: minorRoom,
          follow_until: new Date(Date.now() + 60_000),
        });
        const pendingRanked = await challenge({
          challenged_actor_id: adult,
          mode: 'ranked',
          division: 'open',
        });
        await scratch.migrate((folder) => folder <= migration);
        const rooms = await f.sql`select id, division from rooms
        where id in ${f.sql([minorRoom, adultRoom, unknownRoom])}`;
        const divisionOf = (id: string) =>
          rooms.find((row: { id: string }) => row.id === id)?.division;
        const challenges = await f.sql`select id, division from challenges
        where id in ${f.sql([pendingCasual, answeredCasual, pendingRanked])}`;
        const challengeOf = (id: string) =>
          challenges.find((row: { id: string }) => row.id === id)?.division ??
          'withdrawn';
        assert({
          given:
            'Rooms hosted by a 15-year-old, an adult and a member with no age record, and an unanswered casual, an answered casual and an unanswered ranked challenge',
          should:
            'put each Room in its host’s lobby (Open with no record), withdraw the unanswered casual offer, give the answered one its Room’s lobby and keep the ranked one’s',
          actual: {
            minorRoom: divisionOf(minorRoom),
            adultRoom: divisionOf(adultRoom),
            unknownRoom: divisionOf(unknownRoom),
            pendingCasual: challengeOf(pendingCasual),
            answeredCasual: challengeOf(answeredCasual),
            pendingRanked: challengeOf(pendingRanked),
          },
          expected: {
            minorRoom: 'youth',
            adultRoom: 'open',
            unknownRoom: 'open',
            pendingCasual: 'withdrawn',
            answeredCasual: 'youth',
            pendingRanked: 'open',
          },
        });
      } finally {
        // Challenges hold their actors: they go before the fixture's own rows.
        await f.sql`delete from challenges where challenger_actor_id = ${minor}`;
      }
    });
  },
  ddlTimeoutMs,
);
