import { readRoundCompetitionSource } from '@daisy/db/round-competition';
import { withRolledBackDatabase } from '@daisy/db/testing';
import { requireTestServices } from '@daisy/config';
import { isAppError } from '@daisy/errors';
import { scratchDatabase, daisyOrganizationId } from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';
import {
  daisyWinnerBallot,
  judgeSeat,
  type BallotDefinition,
} from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withRoomRuntime } from './room-runtime.test-support';
import {
  everyoneReady,
  playOut,
  readBallotAs,
} from './round-judging.test-support';
import { finalizeAsWeb } from './round-maintenance.test-support';
import { seedSettledAttendanceLedger } from './round-attendance-fixture.test-support';
import { createRoundBallotOperations } from '../src/features/round-ballots/operations';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('DEC408 actual Start freezes the exact stored pin after currentVersion moves; foreign and malformed sources refuse atomically', async () => {
  const scratch = scratchDatabase(databaseUrl, 'customballot');
  await scratch.create();
  try {
    await scratch.migrate(() => true);
    await withRoomRuntime(
      async (f) => {
        const definition: BallotDefinition = {
          ...daisyWinnerBallot,
          key: 'stored-start-proof',
          revision: 1,
          points: {
            ...daisyWinnerBallot.points!,
            per: 'seat',
            scale: { min: 1, max: 30, step: 0.5 },
            default: 10,
            criteria: { kind: 'holistic' },
          },
          speakerRanks: true,
          written: { reason: null, feedback: null },
        };
        const ballotId = createId();
        // Actual immutable definition/version rows; this test isolates Start, not authoring permission.
        await f.sql.begin(async (tx) => {
          await tx`insert into ballot_definitions(id,organization_id,name,current_version) values(${ballotId},${daisyOrganizationId},'Exact Start proof',1)`;
          await tx`insert into ballot_definition_versions(ballot_definition_id,version,organization_id,definition) values(${ballotId},1,${daisyOrganizationId},${JSON.stringify(definition)}::text::jsonb)`;
        });
        const assemble = async (
          cast: Awaited<ReturnType<typeof f.freshCast>>,
          judge: typeof f.host,
        ) => {
          let room = await f.assemble(
            {
              selection: {
                kind: 'catalog',
                formatId: 'policy',
                formatVersion: 1,
                presetVersion: 1,
                competitionType: 'casual',
              },
            },
            cast,
          );
          room = (
            await f.command(judge, room, {
              type: 'claim-seat',
              seat: judgeSeat(0),
            })
          ).view;
          return everyoneReady(f, room, [cast.host, cast.guest, judge]);
        };
        const cast = { host: f.host, guest: f.guest };
        let room = await assemble(cast, f.outsider);
        await f.sql`update rooms set ballot_definition_id=${ballotId},ballot_definition_version=1 where id=${room.id}`;
        await f.sql.begin(async (tx) => {
          await tx`insert into ballot_definition_versions(ballot_definition_id,version,organization_id,definition) values(${ballotId},2,${daisyOrganizationId},${JSON.stringify({ ...definition, revision: 2, points: null, speakerRanks: false })}::text::jsonb)`;
          await tx`update ballot_definitions set current_version=2 where id=${ballotId}`;
        });
        const launched = await f.command(f.host, room, { type: 'start-round' });
        const [frozen] =
          await f.sql`select judging,ballot_definition_id,ballot_definition_version from rounds where id=${launched.view.roundRef!.id}`;
        assert({
          given:
            'a real ready Room pinned to version1, followed by a real currentVersion2',
          should:
            'freeze the exact original definition/reference and intended panel through ordinary Start',
          actual: frozen,
          expected: {
            judging: {
              source: { kind: 'stored', id: ballotId, version: 1 },
              ballot: definition,
              panel: { decision: 'majority', quorum: 1 },
            },
            ballot_definition_id: ballotId,
            ballot_definition_version: 1,
          },
        });
        const roundId = launched.view.roundRef!.id;
        await playOut(f, roundId, true);
        const freeze = await finalizeAsWeb(f, roundId);
        if (freeze.status !== 'frozen')
          throw new Error(`Actual freeze did not complete: ${freeze.status}`);
        // This storage-contract proof supplies settled attendance; the complete sampler journey is separate.
        await seedSettledAttendanceLedger(f, roundId);
        const round = (await f.store.getRound(roundId))!;
        const competitors = round.participants.filter(
          (person) => person.seat.kind === 'side',
        );
        const judge = round.participants.find(
          (person) => person.actorId === f.outsider.actorId,
        )!;
        const body = {
          rubricVersion: 'stored-start-proof@1',
          winner: 'affirmative',
          scores: Object.fromEntries(
            competitors.map((person, i) => [person.id, i === 0 ? 27.5 : 26]),
          ),
          speakerRanks: competitors.map((person) => [person.id]),
        };
        const operations = createRoundBallotOperations({
          store: f.store,
          nextBallotId: createId,
          nextSegmentId: createId,
        });
        const envelope = {
          version: 1 as const,
          commandId: createId(),
          expectedVersion: round.version,
          judgeParticipantId: judge.id,
          freezeRevision: freeze.freeze.revision,
          ballot: body,
        };
        const principal = {
          kind: 'human' as const,
          actorId: f.outsider.actorId,
        };
        const state = async () =>
          JSON.stringify(
            (
              await f.sql`select (select to_jsonb(r) from rounds r where id=${roundId}) as round,(select coalesce(jsonb_agg(to_jsonb(c) order by command_id),'[]'::jsonb) from round_commands c where round_id=${roundId}) as commands,(select coalesce(jsonb_agg(to_jsonb(b) order by id),'[]'::jsonb) from ballots b where round_id=${roundId}) as ballots`
            )[0],
          );
        const unrelated = (await f.freshCast()).host;
        const deniedBefore = await state();
        let foreignSubmit = false;
        try {
          await operations.submit(
            { kind: 'human', actorId: unrelated.actorId },
            roundId,
            {
              ...envelope,
              commandId: createId(),
            },
          );
        } catch (error) {
          if (!isAppError(error) || error.code !== 'AUTHORIZATION') throw error;
          foreignSubmit = true;
        }
        let privateReadRefused = false;
        try {
          await readBallotAs(f, unrelated, roundId);
        } catch (error) {
          if (!isAppError(error) || error.code !== 'NOT_FOUND') throw error;
          privateReadRefused = true;
        }
        assert({
          given:
            'an actual unrelated adult who knows the exact private Round, stored definition, judge seat and ballot body',
          should:
            'read no private ballot or Round and submit no impersonated ballot through the ordinary guarded adapters',
          actual: {
            privateReadRefused,
            foreignSubmit,
            unchanged: deniedBefore === (await state()),
          },
          expected: {
            privateReadRefused: true,
            foreignSubmit: true,
            unchanged: true,
          },
        });
        const invalidBefore = await state();
        const invalidRefusals = [];
        for (const extra of [
          { reason: 'Off means no text' },
          { feedback: {} },
          { privateNote: 'Unavailable' },
        ]) {
          try {
            await operations.submit(principal, roundId, {
              ...envelope,
              commandId: createId(),
              ballot: { ...body, ...extra },
            });
            invalidRefusals.push('accepted');
          } catch (error) {
            invalidRefusals.push(
              isAppError(error) ? error.code : 'unexpected-error',
            );
          }
        }
        assert({
          given:
            'attempted off reason/feedback or private note on a real frozen custom Round',
          should: 'refuse each with no Round, command or ballot write',
          actual: [invalidRefusals, invalidBefore === (await state())],
          expected: [['VALIDATION', 'VALIDATION', 'VALIDATION'], true],
        });
        const receipt = await operations.submit(principal, roundId, envelope);
        const replay = await operations.submit(principal, roundId, envelope);
        const own = await readBallotAs(f, f.outsider, roundId);
        const exported = await withRolledBackDatabase(scratch.url, {
          seed: async () => null,
          work: (database) =>
            database.transaction((tx) =>
              readRoundCompetitionSource(tx, { roundId, roomId: room.id }),
            ),
        });
        const [terminal] =
          await f.sql`select command_id,resulting_version from round_finalizations where round_id=${roundId}`;
        const publishedBallot = exported?.panel[0]?.ballot;
        assert({
          given: 'the genuinely submitted and finalized custom ballot',
          should:
            'publish only exact consumed competition data with its real terminal witness',
          actual: [
            exported?.source.freezeRevision,
            exported?.source.finalization,
            publishedBallot?.kind === 'submitted'
              ? publishedBallot.contribution
              : null,
            publishedBallot?.kind === 'submitted'
              ? publishedBallot.ballotId
              : null,
          ],
          expected: [
            freeze.freeze.revision,
            {
              commandId: terminal!.command_id,
              resultingVersion: Number(terminal!.resulting_version),
            },
            body,
            receipt.ballotId,
          ],
        });

        const [stored] =
          await f.sql`select b.rubric_version,b.ballot_definition_id,b.ballot_definition_version,b.reason,b.feedback,b.speaker_ranks,f.ballot_digest=daisy_ballot_content_digest(b) as consumed_exactly,(select count(*)::int from round_commands where round_id=${roundId} and type='submit_ballot') as submissions from ballots b join round_finalization_ballots f on f.ballot_id=b.id where b.id=${receipt.ballotId}`;
        assert({
          given:
            'a real human custom ballot with per-seat scores, enabled speaker ranks and written parts off',
          should:
            'persist/reconnect on its exact source, consume the full content and replay one original receipt',
          actual: { stored, own: own.own?.ballot, replay },
          expected: {
            stored: {
              rubric_version: 'stored-start-proof@1',
              ballot_definition_id: ballotId,
              ballot_definition_version: 1,
              reason: null,
              feedback: null,
              speaker_ranks: body.speakerRanks,
              consumed_exactly: true,
              submissions: 1,
            },
            own: body,
            replay: receipt,
          },
        });
        const otherLobby = createId(),
          foreignId = createId(),
          malformedId = createId();
        await f.sql.begin(async (tx) => {
          await tx`insert into lobbies(id,kind,owner_organization_id,name,handle) values(${otherLobby},'standing',${daisyOrganizationId},'Other source lobby',${`source-${otherLobby}`})`;
          await tx`insert into ballot_definitions(id,lobby_id,name,current_version) values(${foreignId},${otherLobby},'Foreign source',1)`;
          await tx`insert into ballot_definition_versions(ballot_definition_id,version,lobby_id,definition) values(${foreignId},1,${otherLobby},${JSON.stringify(definition)}::text::jsonb)`;
          await tx`insert into ballot_definitions(id,organization_id,name,current_version) values(${malformedId},${daisyOrganizationId},'Malformed source',1)`;
          await tx`insert into ballot_definition_versions(ballot_definition_id,version,organization_id,definition) values(${malformedId},1,${daisyOrganizationId},${JSON.stringify({ unexpected: true })}::text::jsonb)`;
        });
        const nextCast = await f.freshCast();
        room = await assemble(nextCast, await f.member());
        const refusals = [];
        for (const id of [foreignId, malformedId]) {
          await f.sql`update rooms set ballot_definition_id=${id},ballot_definition_version=1 where id=${room.id}`;
          const before = await f.snapshot(room.id);
          let refusal: string | null = null;
          try {
            await f.command(nextCast.host, room, { type: 'start-round' });
          } catch (error) {
            refusal = isAppError(error)
              ? (error.reason ?? error.code)
              : 'unexpected-error';
          }
          refusals.push([refusal, before === (await f.snapshot(room.id))]);
        }
        assert({
          given:
            'actual foreign-lobby and malformed immutable version rows pinned to a ready Room',
          should: 'refuse both with no Room/cast/Round/receipt/outbox change',
          actual: refusals,
          expected: [
            ['ballot-definition-unavailable', true],
            ['ballot-definition-unavailable', true],
          ],
        });
      },
      { databaseUrl: scratch.url },
    );
  } finally {
    await scratch.drop();
  }
}, 60_000);
