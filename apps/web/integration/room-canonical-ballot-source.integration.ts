import { readRoundCompetitionSource } from '@daisy/db/round-competition';
import { requireTestServices } from '@daisy/config';
import { withRolledBackDatabase } from '@daisy/db/testing';
import { judgeSeat } from '@daisy/protocol/seats';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withRoomRuntime } from './room-runtime.test-support';
import {
  everyoneReady,
  playOut,
  submitHumanBallot,
  fixtureBallot,
} from './round-judging.test-support';
import { finalizeAsWeb } from './round-maintenance.test-support';
import { seedSettledAttendanceLedger } from './round-attendance-fixture.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

const reason = 'A real submitted contract fixture, kept out of the source.';

test('a finalized Daisy ballot publishes only its consumed competition reference, and a mismatched digest publishes nothing', async () => {
  await withRoomRuntime(async (f) => {
    let room = await f.assemble({
      selection: {
        kind: 'catalog',
        formatId: 'nsda-ld',
        formatVersion: 1,
        presetVersion: 1,
        competitionType: 'casual',
      },
    });
    room = (
      await f.command(f.outsider, room, {
        type: 'claim-seat',
        seat: judgeSeat(0),
      })
    ).view;
    room = await everyoneReady(f, room, [f.host, f.guest, f.outsider]);
    const launched = await f.command(f.host, room, { type: 'start-round' });
    const roundId = launched.view.roundRef!.id;
    await playOut(f, roundId, true);
    const freeze = await finalizeAsWeb(f, roundId);
    if (freeze.status !== 'frozen') throw new Error('Expected a frozen Round');
    await seedSettledAttendanceLedger(f, roundId);
    const { ballotId } = await submitHumanBallot(
      f,
      roundId,
      f.outsider.actorId,
      freeze.freeze.revision,
      fixtureBallot(reason),
    );
    const [screenings] =
      await f.sql`select count(*)::int n from ballot_screenings where ballot_id=${ballotId}`;
    assert({
      given: 'an ordinary submitted Daisy ballot',
      should: 'write no screening row',
      actual: screenings!.n,
      expected: 0,
    });
    const [owner] =
      await f.sql`select r.room_id,f.freeze_revision from rounds r join round_finalizations f on f.round_id=r.id where r.id=${roundId}`;
    const read = (seed: Parameters<typeof withRolledBackDatabase>[1]['seed']) =>
      withRolledBackDatabase(databaseUrl, {
        seed,
        work: (database) =>
          database.transaction((tx) =>
            readRoundCompetitionSource(tx, {
              roundId,
              roomId: String(owner!.room_id),
            }),
          ),
      });
    const published = await read(async () => null);
    const contribution = published?.panel[0]?.ballot;
    const corrupt = await read(async (client) => {
      await client`set local session_replication_role = replica`;
      await client`update round_finalization_ballots set ballot_digest=${'0'.repeat(64)} where ballot_id=${ballotId}`;
      await client`set local session_replication_role = origin`;
    });
    assert({
      given: 'a finalized ordinary ballot whose reason remains stored',
      should:
        'publish its consumed competition reference without words or citation text, and nothing once the consumed digest no longer matches',
      actual: [
        contribution?.kind === 'submitted' ? contribution.ballotId : null,
        published?.source.freezeRevision,
        JSON.stringify(published).includes(reason),
        JSON.stringify(contribution ?? null).includes('"reason"'),
        JSON.stringify(contribution ?? null).includes('"feedback"'),
        JSON.stringify(contribution ?? null).includes('"citations"'),
        corrupt,
      ],
      expected: [
        ballotId,
        Number(owner!.freeze_revision),
        false,
        false,
        false,
        false,
        null,
      ],
    });
    const [digest] =
      await f.sql`select f.ballot_digest=daisy_ballot_content_digest(b) as unchanged_digest,r.status from ballots b join round_finalization_ballots f on f.ballot_id=b.id join rounds r on r.id=b.round_id where b.id=${ballotId}`;
    assert({
      given: 'the finalized consumed ballot',
      should: 'pin its content digest and complete the Round',
      actual: digest,
      expected: { unchanged_digest: true, status: 'completed' },
    });
  });
}, 60_000);
