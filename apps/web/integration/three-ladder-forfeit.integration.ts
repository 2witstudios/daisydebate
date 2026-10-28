import { requireTestServices } from '@daisy/config';
import { withSeasons } from '@daisy/db/seasons';
import { createId } from '@paralleldrive/cuid2';
import { ratingLadders } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  withRoomRuntime,
  startRuntimeRound,
} from './round-runtime.test-support';
import { readyRatedRoom } from './rated-room.test-support';
import { createRatingSweep } from '../src/features/ratings/sweep';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

for (const ladder of ratingLadders)
  test(`${ladder}: a pre-freeze human forfeit posts the original terminal command exactly once`, async () => {
    await withRoomRuntime(async (f) => {
      const seasonId = createId();
      let roundId: string | undefined;
      try {
        await withSeasons(databaseUrl, (s) =>
          s.activateBetaSeason({ id: seasonId }),
        );
        const started = await startRuntimeRound(
          f,
          await readyRatedRoom(f, ladder, 'human'),
        );
        roundId = started.roundId;
        const commandId = createId();
        await started.operations.command(
          { kind: 'human', actorId: f.guest.actorId },
          roundId,
          {
            version: 1,
            commandId,
            expectedVersion: started.receipt.resultingVersion,
            command: {
              type: 'forfeit',
              participantId: (await f.store.getRound(
                roundId,
              ))!.participants.find((p) => p.actorId === f.guest.actorId)!.id,
            },
          },
        );
        const sweep = () =>
          createRatingSweep({
            database: f.store,
            ids: { next: createId },
            onFailure: (_id, error) => {
              throw error;
            },
          })({ limit: 64 });
        await Promise.all([sweep(), sweep()]);
        const [source] =
          await f.sql`select command_id,freeze_revision from round_finalizations where round_id=${roundId}`;
        const ledger =
          await f.sql`select ladder,season_id from rating_changes where round_id=${roundId}`;
        assert({
          given: `a ${ladder} forfeit before any transcript freeze with duplicate delivery`,
          should:
            'retain the exact forfeit command with no invented freeze or ballot and atomically post two changes',
          actual: {
            command: source.command_id,
            freeze: source.freeze_revision,
            ballots: (
              await f.sql`select ballot_id from round_finalization_ballots where round_id=${roundId}`
            ).length,
            rows: ledger.map((r: { ladder: string; season_id: string }) => [
              r.ladder,
              r.season_id,
            ]),
          },
          expected: {
            command: commandId,
            freeze: null,
            ballots: 0,
            rows: [
              [ladder, seasonId],
              [ladder, seasonId],
            ],
          },
        });
      } finally {
        if (roundId)
          await f.sql`delete from rating_changes where round_id=${roundId}`;
        await f.sql`delete from ratings where actor_id in (${f.host.actorId},${f.guest.actorId})`;
        await f.sql`delete from seasons where id=${seasonId}`;
      }
    });
  });
