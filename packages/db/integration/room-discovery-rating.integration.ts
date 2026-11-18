import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withDiscoveryFixture } from './room-discovery.test-support';

requireTestServices(process.env);
setupRitewayBun();

test('starting ranked discovery projects the host current-season Freestyle rating', async () =>
  withDiscoveryFixture(async ({ f, caller, token, nextId, list: query }) => {
    const formatId = 'freestyle';
    const starting = nextId();
    for (const [id, status, mode] of [
      [starting, 'ready', 'ranked'],
      [nextId(), 'assembling', 'ranked'],
      [nextId(), 'ready', 'casual'],
    ] as const)
      await f.room(caller.actorId, formatId, {
        id,
        title: token,
        topic: token,
        preset_version: mode === 'ranked' ? 1 : null,
        competition_type: mode,
        status,
      });
    // The host sits as an adult debater, so the ranked Rooms are on Open –
    // Freestyle and the host's rating there is the one a row shows (ADR 0147).
    await f.sql`insert into account_age (user_id, birth_month, version, recorded_at)
      values (${caller.userId}, '1990-01', 1, '2001-01-01T00:00:00Z') on conflict do nothing`;
    for (const roomId of [starting])
      await f.insert('room_participants', {
        id: nextId(),
        room_id: roomId,
        actor_id: caller.actorId,
        seat_kind: 'side',
        side: 'affirmative',
        slot: 0,
      });
    for (const [status, rating] of [
      ['closed', 2200],
      ['active', 1612.6],
    ] as const) {
      const seasonId = nextId();
      await f.insert('seasons', {
        division: 'open',
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
          season_id: seasonId,
          ladder: 'freestyle',
          division: 'open',
          rating,
          deviation: 100,
          volatility: 0.06,
        },
        'actor_id',
      );
    }
    const list = (hidden: boolean) =>
      query(
        {
          q: token,
          pageSize: 20,
          status: 'starting',
          mode: 'ranked',
        },
        hidden,
      );
    const page = await list(false);
    const masked = await list(true);
    assert({
      given:
        'ready ranked, assembling ranked and ready casual Rooms, with past and current ratings',
      should:
        'list only the ready ranked Room with the rounded current-season Freestyle value',
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
