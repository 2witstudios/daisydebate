import { requireTestServices } from '@daisy/config';
import {
  daisyOrganizationId,
  scratchDatabase,
  seedRatingSeason,
  validRules,
} from '@daisy/db/testing';
import { emptyRuntimeCheckpointFor } from '@daisy/protocol/round';
import { isNamedSeat } from '@daisy/protocol/round-view';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readyRankedRoom } from './ranked-room.test-support';
import {
  launchRuntimeRound,
  withRoomRuntime,
} from './round-runtime.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('ranked discovery publishes the host rating from the Room pool', async () => {
  const scratch = scratchDatabase(databaseUrl, 'discoveryrating');
  await scratch.create();
  try {
    await scratch.migrate(() => true);
    await withRoomRuntime(
      async (f) => {
        const { sql, host, guest } = f;
        const selectedLadderId = createId();
        const { id: seasonId, lobbyId } = await seedRatingSeason(
          sql,
          createId(),
        );
        const oldestLadderId = 'freestyle';
        await sql`insert into ladders(id,lobby_id,organization_id,name)
        values (${selectedLadderId},${lobbyId},${daisyOrganizationId},'Catalog ladder')`;
        await sql`insert into settings(id,scope_kind,lobby_id,key,hold,value)
        values (${createId()},'lobby',${lobbyId},'standings.rating_ladder','default',${{ ladderId: selectedLadderId }})`;

        // Seed completed games and the corresponding ledger and projection, with
        // timestamps before the public spectator horizon.
        for (const [ladderId, rating] of [
          [oldestLadderId, 1631],
          [selectedLadderId, 1384],
        ] as const) {
          const roundId = createId();
          const startedAt = new Date('2026-01-02T00:00:00Z');
          const completedAt = new Date('2026-01-02T01:00:00Z');
          await sql.begin(async (tx) => {
            await tx`insert into rounds (id,resolution,competition_type,format_id,format_version,preset_version,rules_snapshot,status,runtime_state,visibility,ladder_id,season_id,rating_lobby_id)
            values (${roundId},'Published rating fixture','ranked','freestyle',1,1,${validRules},'opening',${emptyRuntimeCheckpointFor(validRules)},'public',${ladderId},${seasonId},${lobbyId})`;
            await tx`insert into round_participants(id,round_id,actor_id,seat_kind,side,slot)
            values (${createId()},${roundId},${host.actorId},'side','affirmative',0),
              (${createId()},${roundId},${guest.actorId},'side','negative',0)`;
            await tx`update rounds set status='completed',started_at=${startedAt},completed_at=${completedAt},winning_side='affirmative' where id=${roundId}`;
            await tx`insert into rating_changes (id,round_id,actor_id,season_id,ladder,lobby_id,format_id,rating_before,rating_after,deviation_before,deviation_after,volatility_before,volatility_after,calculation_version,occurred_at)
            values (${createId()},${roundId},${host.actorId},${seasonId},${ladderId},${lobbyId},'freestyle',1500,${rating},350,100,0.06,0.06,'glicko2-v1',${completedAt})`;
            await tx`insert into ratings(actor_id,season_id,ladder,lobby_id,rating,deviation,volatility)
            values (${host.actorId},${seasonId},${ladderId},${lobbyId},${rating},100,0.06)`;
          });
        }

        const room = await readyRankedRoom(f, 'freestyle', 'human');
        const ratingsInDiscoveryAndRoom = async () => {
          const page = await f.operations.list(host, {
            lobbyId,
            q: room.title,
            pageSize: 20,
          });
          const view = await f.operations.view(host, room.id);
          const seat = view.participants
            .filter(isNamedSeat)
            .find(({ actorId }) => actorId === host.actorId);
          return [
            page.rooms.find(({ id }) => id === room.id)?.hostRating,
            seat?.rating?.value,
          ];
        };
        assert({
          given:
            'two published host ratings in one official lobby whose catalog prefers the newer ladder',
          should:
            'show the oldest ladder rating in discovery and the unpinned ranked Room',
          actual: await ratingsInDiscoveryAndRoom(),
          expected: [1631, 1631],
        });

        await launchRuntimeRound(f, room);
        const judgePage = await f.operations.list(f.outsider, {
          lobbyId,
          q: room.title,
          pageSize: 20,
          status: 'live',
        });
        assert({
          given:
            'the live ranked Room listed by its judge before a ballot is submitted',
          should:
            'hide the debater host rating while leaving the Room discoverable to that participant',
          actual: judgePage.rooms.map(({ id, hostActorId, hostRating }) => [
            id,
            hostActorId,
            hostRating,
          ]),
          expected: [[room.id, host.actorId, null]],
        });
        await sql`update seasons set status='closed',ends_at=now() where id=${seasonId}`;
        const nextSeason = await seedRatingSeason(sql, createId());
        const nextHost = await f.member();
        // A projection without a public posting should never decorate a card.
        await sql`insert into ratings(actor_id,season_id,ladder,lobby_id,rating,deviation,volatility)
          values (${nextHost.actorId},${nextSeason.id},${oldestLadderId},${lobbyId},2190,100,0.06)`;
        const open = (
          await f.create(
            {
              title: room.title,
              selection: {
                kind: 'ranked',
                formatId: 'freestyle',
                formatVersion: room.formatVersion,
                presetVersion: room.presetVersion!,
              },
            },
            nextHost,
          )
        ).view;
        const openPage = await f.operations.list(host, {
          lobbyId,
          q: open.title,
          pageSize: 20,
        });
        assert({
          given:
            'an open ranked Room whose host has a projection with no public posting',
          should:
            'leave the host rating empty and omit internal pool data from the card',
          actual: openPage.rooms
            .filter(({ id }) => id === open.id)
            .map((card) => [
              card.id,
              card.hostRating,
              'hostRatingPool' in card,
            ]),
          expected: [[open.id, null, false]],
        });
        assert({
          given:
            'the launched Room after its standing lobby opens a new season',
          should:
            'keep displaying the rating from its frozen ladder and season',
          actual: await ratingsInDiscoveryAndRoom(),
          expected: [1631, 1631],
        });
      },
      { databaseUrl: scratch.url },
    );
  } finally {
    await scratch.drop();
  }
});
