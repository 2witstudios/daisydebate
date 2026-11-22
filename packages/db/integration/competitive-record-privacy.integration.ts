import { requireTestServices } from '@daisy/config';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { competitiveRecordPrivacyAdopter } from '../src/competitive-record-privacy';
import { withFixture } from './constraint-helpers';
import { at, completed, rating, season } from './standings-fixtures';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('competitive record erasure preserves the ledger and export scopes every table', async () => {
  await withFixture(url, async (fixture) => {
    const userId = await fixture.user();
    const actorId = await fixture.actor(userId);
    const peer = await fixture.actor();
    const seasonId = await season(fixture, 'closed', at(1));
    const roundId = await completed(fixture, {
      formatId: 'freestyle',
      affirmative: actorId,
      negative: peer,
      outcome: 'affirmative',
      seasonId,
    });
    for (const participant of [actorId, peer])
      await rating(fixture, {
        formatId: 'freestyle',
        seasonId,
        ladder: 'freestyle',
        actorId: participant,
        rating: 1500,
      });
    const statements: { query: string; params: unknown[] }[] = [];
    const database = drizzle({
      client: fixture.sql,
      logger: {
        logQuery: (query, params) => statements.push({ query, params }),
      },
    });
    const subject = { userId, actorId };
    const before = await competitiveRecordPrivacyAdopter.export(
      database,
      subject,
    );
    const reads = statements.splice(0);
    await competitiveRecordPrivacyAdopter.erase(database, subject, {
      now: at(6).toISOString(),
    });
    const writes = statements.splice(0);
    const after = await competitiveRecordPrivacyAdopter.export(
      database,
      subject,
    );
    assert({
      given: 'a real shared ranked Round and each participant’s rating',
      should:
        'make no erasure writes, export a stable subject-only record, and bind each read to the actor',
      actual: {
        tables: Object.keys(after).sort(),
        retained: [
          after.rounds?.length,
          after.ratings?.length,
          after.round_participants?.length,
          after.rounds?.[0]?.id,
        ],
        stable: Bun.deepEquals(before, after),
        writes,
        scoped:
          reads.length === 13 &&
          reads.every(
            ({ params }) => params.includes(actorId) && !params.includes(peer),
          ),
      },
      expected: {
        tables: [
          'ballots',
          'rating_changes',
          'ratings',
          'room_participants',
          'room_seat_holds',
          'rooms',
          'round_finalization_judge_assignments',
          'round_judge_assignments',
          'round_judge_slots',
          'round_participants',
          'round_resolution_strikes',
          'round_source_voids',
          'rounds',
        ],
        retained: [1, 1, 1, roundId],
        stable: true,
        writes: [],
        scoped: true,
      },
    });
  });
});
