import { readRoundCompetitionSource } from '@daisy/db/round-competition';
import { SQL } from 'bun';
import { requireTestServices } from '@daisy/config';
import {
  scratchDatabase,
  withRolledBackDatabase,
  loanRoundAssignmentInterface,
} from '@daisy/db/testing';
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
const sourceMigration = '20261117003143_tab_wiring';

test('canonical source/storage migrations preserve a genuinely submitted and finalized Daisy ballot and its consumed v1 digest', async () => {
  const scratch = scratchDatabase(databaseUrl, 'ballotupgrade');
  await scratch.create();
  const sql = new SQL(scratch.url, { max: 1 });
  try {
    await scratch.migrate((tag) => tag < sourceMigration);
    // Only a decoder/consumption interface is lent to today's adapters. The
    // digest uses the exact forward SQL and the real stored submitted ballot.
    const migrationSql = await Bun.file(
      new URL(
        '../../../packages/db/migrations/20261117003143_tab_wiring/migration.sql',
        import.meta.url,
      ),
    ).text();
    const statements = migrationSql.split('--> statement-breakpoint');
    for (const prefix of [
      'CREATE FUNCTION daisy_ballot_content_digest',
      'ALTER TABLE round_finalization_ballots ADD COLUMN ballot_digest',
      'CREATE FUNCTION pin_finalization_ballot_digest',
      'CREATE TRIGGER round_finalization_ballot_digest',
    ]) {
      const statement = statements.find((statement) =>
        statement.includes(prefix),
      );
      if (!statement)
        throw new Error(`Missing actual forward interface: ${prefix}`);
      await sql.unsafe(statement);
    }
    await sql`alter table rooms add column standing_template_id text generated always as (case when lobby_kind='standing' then template_id else null end) stored`;
    // Current adapters select these columns. Lend their nullable interface for the
    // real Daisy journey only, then remove it before the generated migrations run.
    await sql`alter table rounds add column ballot_definition_id text,add column ballot_definition_version integer`;
    await sql`alter table rooms add column league_ladder_id text`;
    await sql`alter table rounds add column league_ladder_id text`;
    await sql`alter table ballots add column speaker_ranks jsonb`;
    // Empty decoder interface only: the real pre-upgrade ordinary journey has
    // no tournament hosting grant, version, issuer or inferred funding account.
    await sql`alter table account_entitlement_grants add column hosting_version_id text,add column revoked_at timestamptz`;
    await sql`create table account_hosting_versions (
      id text,user_id text,source text,version integer,starts_at timestamptz,expires_at timestamptz,
      issuer_service_id text,issuer_operator_ref text,decision_reference text,
      subscription_id text,subscription_observed_at timestamptz,subscription_evidence jsonb,coverage jsonb)`;
    await sql`grant select on account_hosting_versions to daisy_web`;
    const removeAssignmentInterface = await loanRoundAssignmentInterface(sql);
    const completed: { value: { roundId: string; ballotId: string } | null } = {
      value: null,
    };
    await withRoomRuntime(
      async (f) => {
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
    await sql`alter table rooms drop column league_ladder_id`;
    await sql`alter table rounds drop column league_ladder_id`;
    await sql`alter table ballots drop column speaker_ranks`;
    await sql`drop table account_hosting_versions`;
    await sql`alter table account_entitlement_grants drop column hosting_version_id,drop column revoked_at`;
    await removeAssignmentInterface();
    await sql`alter table rooms drop column standing_template_id`;
    await sql`drop trigger round_finalization_ballot_digest on round_finalization_ballots`;
    await sql`drop function pin_finalization_ballot_digest()`;
    await sql`drop function daisy_ballot_content_digest(ballots)`;
    await sql`alter table round_finalization_ballots drop column ballot_digest`;
    await scratch.migrate(() => true);
    const after = await read();
    const [screenings] =
      await sql`select count(*)::int n from ballot_screenings where ballot_id=${ballotId}`;
    assert({
      given:
        'the genuine ordinary submission before the event-only screening forward',
      should:
        'retain no screening row after upgrade, without a decoder loan or synthetic disposition',
      actual: screenings!.n,
      expected: 0,
    });
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
