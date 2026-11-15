import { readRoundCompetitionSource } from '@daisy/db/round-competition';
import { SQL } from 'bun';
import { requireTestServices } from '@daisy/config';
import { scratchDatabase, withRolledBackDatabase } from '@daisy/db/testing';
import { judgeSeat } from '@daisy/protocol';
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
const sourceMigration = '20261115145330_canonical_ballot_source';

test('canonical source/storage migrations preserve a genuinely submitted and finalized Daisy ballot and its consumed v1 digest', async () => {
  const scratch = scratchDatabase(databaseUrl, 'ballotupgrade');
  await scratch.create();
  const sql = new SQL(scratch.url, { max: 1 });
  try {
    await scratch.migrate((tag) => tag < sourceMigration);
    // Current adapters select these columns. Lend their nullable interface for the
    // real Daisy journey only, then remove it before the generated migrations run.
    await sql`alter table rounds add column ballot_definition_id text,add column ballot_definition_version integer`;
    await sql`alter table ballots add column speaker_ranks jsonb`;
    const completed: { value: { roundId: string; ballotId: string } | null } = {
      value: null,
    };
    await withRoomRuntime(
      async (f) => {
        let room = await f.assemble({
          selection: {
            kind: 'catalog',
            formatId: 'policy',
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
        if (freeze.status !== 'frozen')
          throw new Error('Expected actual pre-upgrade freeze');
        await seedSettledAttendanceLedger(f, roundId);
        const receipt = await submitHumanBallot(
          f,
          roundId,
          f.outsider.actorId,
          freeze.freeze.revision,
          fixtureBallot(
            'A real submitted contract fixture, preserved through migration.',
          ),
        );
        completed.value = { roundId, ballotId: receipt.ballotId };
      },
      { databaseUrl: scratch.url },
    );
    if (!completed.value) throw new Error('Missing real completed fixture');
    const { roundId, ballotId } = completed.value;
    const read = () =>
      sql`select (select to_jsonb(r) from rounds r where id=${roundId}) as round,(select to_jsonb(b) from ballots b where id=${ballotId}) as ballot,(select to_jsonb(f) from round_finalizations f where round_id=${roundId}) as finalization,(select to_jsonb(c) from round_commands c join round_finalizations f on f.command_id=c.command_id where f.round_id=${roundId}) as receipt,(select to_jsonb(f) from round_finalization_ballots f where ballot_id=${ballotId}) as consumed`;
    const before = await read();
    await sql`alter table rounds drop column ballot_definition_id,drop column ballot_definition_version`;
    await sql`alter table ballots drop column speaker_ranks`;
    await scratch.migrate(() => true);
    const after = await read();
    const [owner] =
      await sql`select r.room_id,f.freeze_revision from rounds r join round_finalizations f on f.round_id=r.id where r.id=${roundId}`;
    const published = await withRolledBackDatabase(scratch.url, {
      seed: async () => null,
      work: (database) =>
        database.transaction((tx) =>
          readRoundCompetitionSource(tx, {
            roundId,
            roomId: String(owner!.room_id),
          }),
        ),
    });
    const contribution = published?.panel[0]?.ballot;
    assert({
      given:
        'an actual ordinary finalized ballot whose original reason remains retained through migration',
      should:
        'publish its real consumed competition reference without original words or citation text',
      actual: [
        contribution?.kind === 'submitted' ? contribution.ballotId : null,
        published?.source.freezeRevision,
        JSON.stringify(published).includes(
          'A real submitted contract fixture, preserved through migration.',
        ),
        JSON.stringify(contribution ?? null).includes('"reason"'),
        JSON.stringify(contribution ?? null).includes('"feedback"'),
        JSON.stringify(contribution ?? null).includes('"citations"'),
      ],
      expected: [
        ballotId,
        Number(owner!.freeze_revision),
        false,
        false,
        false,
        false,
      ],
    });

    const [digest] =
      await sql`select f.ballot_digest=daisy_ballot_content_digest(b) as unchanged_digest,r.status,(select count(*)::int from results) as results from ballots b join round_finalization_ballots f on f.ballot_id=b.id join rounds r on r.id=b.round_id where b.id=${ballotId}`;
    assert({
      given:
        'actual ordinary Ready/Start, transcript freeze, human submit and finalized consumed evidence before both migrations',
      should:
        'preserve all rows/receipt, exact original v1 digest and completed ending without fabricating any tournament result',
      actual: { rows: [...after], digest },
      expected: {
        rows: [...before],
        digest: { unchanged_digest: true, status: 'completed', results: 0 },
      },
    });
  } finally {
    await sql.close();
    await scratch.drop();
  }
}, 60_000);
