import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { discoverRooms } from '../src/room-discovery';
import { withFixture } from './constraint-helpers';
import { createAuthorizationSubject } from './authorization.test-support';
import { integrationSuite } from './suite.test-support';

requireTestServices(process.env);
setupRitewayBun();
const { databaseUrl } = integrationSuite();

test('starting ranked discovery projects the host current-season Ranked rating', async () =>
  withFixture(databaseUrl, async (f) => {
    const caller = await createAuthorizationSubject(f);
    const formatId = await f.format();
    await f.preset(formatId);
    const token = createId();
    const starting = createId();
    for (const [id, status, mode] of [
      [starting, 'ready', 'ranked'],
      [createId(), 'assembling', 'ranked'],
      [createId(), 'ready', 'casual'],
    ] as const)
      await f.room(caller.actorId, formatId, {
        id,
        title: token,
        topic: token,
        preset_version: mode === 'ranked' ? 1 : null,
        competition_type: mode,
        status,
      });
    for (const [status, rating] of [
      ['closed', 2200],
      ['active', 1612.6],
    ] as const) {
      const seasonId = createId();
      await f.insert('seasons', {
        id: seasonId,
        name: token,
        starts_at: new Date('2026-01-01'),
        ends_at: status === 'closed' ? new Date('2026-02-01') : null,
        status,
      });
      await f.insert(
        'ratings',
        {
          actor_id: caller.actorId,
          format_id: formatId,
          season_id: seasonId,
          ladder: 'ranked',
          rating,
          deviation: 100,
          volatility: 0.06,
        },
        'actor_id',
      );
    }
    const db = drizzle({ client: f.sql });
    const list = (hidden: boolean) =>
      db.transaction((tx) =>
        discoverRooms(
          tx,
          caller,
          { q: token, pageSize: 20, status: 'starting', mode: 'ranked' },
          () => true,
          () => true,
          () => hidden,
        ),
      );
    const page = await list(false);
    const masked = await list(true);
    assert({
      given:
        'ready ranked, assembling ranked and ready casual Rooms, with past and current ratings',
      should:
        'list only the ready ranked Room with the rounded current-season Ranked value',
      actual: page.rooms.map((room) => [
        room.id,
        room.status,
        room.competitionType,
        room.hostRating,
      ]),
      expected: [[starting, 'ready', 'ranked', 1613]],
    });
    assert({
      given: 'the same real rating when the host identity must be hidden',
      should: 'mask the rating together with the host',
      actual: masked.rooms.map((room) => [
        room.hostActorId,
        room.hostLabel,
        room.hostRating,
      ]),
      expected: [[null, null, null]],
    });
  }));
