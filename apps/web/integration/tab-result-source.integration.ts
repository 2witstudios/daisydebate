import { interleaveRoundWriters } from './tab-round-interleaving.test-support';
import { registerFixtureJudge } from './tab-fixture-judge.test-support';
import { fixtureCommand } from '../src/features/tab/operations/fixture-command';
import { proveEventBallotReleases } from './tab-event-ballot-release.test-support';
import type { ResultCompetitionRecord } from '@daisy/protocol/lobby/result-record';
import { as } from './tab-tournament-organization-wiring.test-support';
import { SQL } from 'bun';
import { authorize } from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import {
  scratchDatabase,
  committingRuntimeTestDatabase,
} from '@daisy/db/testing';
import { createTabStore } from '@daisy/db/tab';
import { isDebatingSeat, seatOrder } from '@daisy/protocol/seats';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withRoomRuntime } from './room-runtime.test-support';
import { committedEventRoom } from './tab-event-room-direction.test-support';
import { playOut } from './round-judging.test-support';
import {
  finalizeAsWeb,
  finalizeByMaintenance,
} from './round-maintenance.test-support';
import { seedSettledAttendanceLedger } from './round-attendance-fixture.test-support';
import { createRoundBallotOperations } from '../src/features/round-ballots/operations';
import { resultCommand } from '../src/features/tab/operations/result-command';
import { createAppError, isAppError } from '@daisy/errors';
import { CommandDenied } from '../src/features/tab/commands/run-command';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('actual event Round source persists one immutable competition record, complete correction and atomic projections without private words', async () => {
  const scratch = scratchDatabase(databaseUrl, 'resultsource');
  await scratch.create();
  const owner = new SQL(scratch.url, { max: 1 });
  try {
    await scratch.migrate(() => true);
    const world = await committedEventRoom(owner, 'copy', { noPrep: true });
    await withRoomRuntime(
      async (f) => {
        const director = world.bots.Director!,
          lobbyId = world.made.get('tournament-lobby')!;
        const cast = await owner<
          { actor_id: string; user_id: string }[]
        >`select p.actor_id,a.user_id from room_participants p join actors a on a.id=p.actor_id where p.room_id=${world.roomId}`;
        for (const person of cast) {
          const caller = { actorId: person.actor_id, userId: person.user_id };
          await f.consent(
            caller,
            await f.operations.view(caller, world.roomId),
            'ready',
          );
        }
        const room = await f.operations.view(director, world.roomId);
        const started = await f.operations.command(director, world.roomId, {
          type: 'start-round',
          commandId: createId(),
          expectedVersion: room.version,
        });
        const roundId = started.receipt.roundRef!.id;
        const store = createTabStore(committingRuntimeTestDatabase(owner));
        const nextJudge = await registerFixtureJudge({
          owner,
          store,
          world,
          person: world.bots['Judge C']!,
        });
        const [initial] =
          await owner`select f.id,f.version,j.id judge_id,p.id participant_id from fixtures f join fixture_judges fj on fj.fixture_id=f.id join tournament_judges j on j.id=fj.tournament_judge_id join room_participants p on p.room_id=f.room_id and p.actor_id=j.actor_id where f.room_id=${world.roomId}`;
        const replacementId = createId();
        const officiate = fixtureCommand({
          store,
          authorize,
          now: () => new Date().toISOString(),
          newId: createId,
        });
        const replacement = await officiate(as(director), lobbyId, {
          version: 1,
          commandId: replacementId,
          expected: { fixture: Number(initial!.version) },
          command: {
            type: 'replace-judge',
            fixtureId: String(initial!.id),
            outJudgeId: String(initial!.judge_id),
            inJudgeId: nextJudge.id,
            overrides: [],
          },
        });
        if (replacement.kind !== 'accepted')
          throw new Error('Real Round judge replacement refused');
        // Bounded storage/command proof: existing elapsed-time and attendance
        // fixtures are explicit; this is not the full availability/media journey.
        await playOut(f, roundId, false);
        const frozen = await finalizeAsWeb(f, roundId);
        if (frozen.status !== 'frozen')
          throw new Error(`Expected real freeze, got ${frozen.status}`);
        await seedSettledAttendanceLedger(f, roundId);
        const round = (await f.store.getRound(roundId))!;
        const firstJudge = round.participants.find(
          (person) => person.seat.kind === 'judge',
        )!;
        const competitors = round.participants
          .filter((person) => isDebatingSeat(person.seat))
          .sort((a, b) => seatOrder(round.rules.sides)(a.seat, b.seat));
        const submit = createRoundBallotOperations({
          store: f.store,
          nextBallotId: createId,
          nextSegmentId: createId,
        });
        const ballot = {
          rubricVersion: `${world.copied.definition.key}@1`,
          winner: 'affirmative',
          scores: Object.fromEntries(
            competitors.map((person, index) => [
              person.id,
              index === 0 ? 0.35 : 0.25,
            ]),
          ),
          speakerRanks: competitors.map((person) => [person.id]),
        };
        const raceOfficiate = fixtureCommand({
          store: createTabStore(committingRuntimeTestDatabase(f.sql)),
          authorize,
          now: () => new Date().toISOString(),
          newId: createId,
        });
        const [beforeRace] =
          await owner`select version from fixtures where id=${initial!.id}`;
        const returnId = createId();
        const raceEnvelope = {
          version: 1,
          commandId: returnId,
          expected: { fixture: Number(beforeRace!.version) },
          command: {
            type: 'replace-judge',
            fixtureId: String(initial!.id),
            outJudgeId: nextJudge.id,
            inJudgeId: String(initial!.judge_id),
            overrides: [],
          },
        };
        const retiredSubmission = {
          version: 1 as const,
          commandId: createId(),
          expectedVersion: round.version,
          judgeParticipantId: firstJudge.id,
          freezeRevision: frozen.freeze.revision,
          ballot,
        };
        const replacingFirst = await interleaveRoundWriters({
          owner,
          observer: f.sql,
          roundId,
          first: () => raceOfficiate(as(director), lobbyId, raceEnvelope),
          second: () =>
            submit.submit(
              { kind: 'human', actorId: firstJudge.actorId },
              roundId,
              retiredSubmission,
            ),
        });
        if (replacingFirst.first.kind === 'failed')
          throw replacingFirst.first.error;
        const retiredError =
          replacingFirst.second.kind === 'failed'
            ? replacingFirst.second.error
            : null;
        assert({
          given:
            'replacement holds actual accounts and waits on the Round before the old judge submission arrives',
          should:
            'commit one fresh assignment and refuse a stale unfenced cast after the real account wait',
          actual: [
            replacingFirst.first.value.kind,
            isAppError(retiredError) ? retiredError.code : null,
            (
              await owner`select count(*)::int n from ballots where round_id=${roundId}`
            )[0]!.n,
          ],
          expected: ['accepted', 'CONFLICT', 0],
        });
        let retiredRetry: unknown = null;
        try {
          await submit.submit(
            { kind: 'human', actorId: firstJudge.actorId },
            roundId,
            retiredSubmission,
          );
        } catch (error) {
          retiredRetry = error;
        }
        assert({
          given:
            'the retired judge retrying after all actual current accounts can be fenced afresh',
          should:
            'refuse current judging authority and retain no ballot or command receipt',
          actual: [
            isAppError(retiredRetry) ? retiredRetry.code : null,
            (
              await owner`select count(*)::int n from round_commands where command_id=${retiredSubmission.commandId}`
            )[0]!.n,
          ],
          expected: ['AUTHORIZATION', 0],
        });
        const currentRound = (await f.store.getRound(roundId))!;
        const judge = currentRound.participants.find(
          (person) => person.seat.kind === 'judge',
        )!;
        const [beforeSubmit] =
          await owner`select version from fixtures where id=${initial!.id}`;
        const submittingFirst = await interleaveRoundWriters({
          owner,
          observer: f.sql,
          roundId,
          first: () =>
            submit.submit({ kind: 'human', actorId: judge.actorId }, roundId, {
              ...retiredSubmission,
              commandId: createId(),
              expectedVersion: currentRound.version,
              judgeParticipantId: judge.id,
            }),
          second: () =>
            raceOfficiate(as(director), lobbyId, {
              ...raceEnvelope,
              commandId: createId(),
              expected: { fixture: Number(beforeSubmit!.version) },
              command: {
                ...raceEnvelope.command,
                outJudgeId: String(initial!.judge_id),
                inJudgeId: nextJudge.id,
              },
            }),
        });
        if (submittingFirst.first.kind === 'failed')
          throw submittingFirst.first.error;
        if (submittingFirst.second.kind === 'failed')
          throw submittingFirst.second.error;
        const submitted = submittingFirst.first.value;
        assert({
          given:
            'the actual ballot writer holds accounts and waits on the Round before replacement arrives',
          should:
            'retain its submitted identity and refuse replacement after the real wait',
          actual: submittingFirst.second.value,
          expected: { kind: 'refused', refusal: 'ballot-submitted' },
        });
        await finalizeByMaintenance(f, roundId);
        const [fixture] =
          await owner`select id,version from fixtures where room_id=${world.roomId}`;
        const send = resultCommand({
          store,
          authorize,
          now: () => new Date().toISOString(),
          newId: createId,
        });
        const envelope = {
          version: 1,
          commandId: createId(),
          expected: { fixture: Number(fixture!.version) },
          command: {
            type: 'record-decided-result',
            fixtureId: String(fixture!.id),
          },
        };
        let denied = false;
        try {
          await send(as(world.bots.Coach!), lobbyId, envelope);
        } catch (error) {
          if (!(error instanceof CommandDenied)) throw error;
          denied = true;
        }
        const answer = await send(as(director), lobbyId, envelope);
        if (answer.kind !== 'accepted')
          throw new Error(`Record refused: ${JSON.stringify(answer)}`);
        const replay = await send(as(director), lobbyId, envelope);
        const [saved] =
          await owner`select competition_record,kind,round_id from results where id=${answer.receipt.aggregate.id}`;
        const record = saved!.competition_record;
        const lineage = await owner<
          {
            slot: number;
            version: number;
            participant_id: string;
            actor_id: string;
            source: string;
            command_id: string | null;
            recorded_at: Date;
          }[]
        >`select a.* from round_finalization_judge_assignments z join round_judge_assignments a on a.round_id=z.round_id and a.slot=z.slot and a.version<=z.assignment_version where z.round_id=${roundId} order by a.slot,a.version`;
        assert({
          given:
            'a genuine post-Start judge replacement followed by its real ballot and ordinary finality',
          should:
            'retain both immutable assignment identities and exact command/observation provenance in the result-owned terminal prefix',
          actual: [
            record.source.judgeAssignments,
            lineage.length,
            lineage[0]!.participant_id,
            lineage[1]!.command_id,
          ],
          expected: [
            [
              {
                slot: 0,
                versions: lineage.map((row) => ({
                  version: row.version,
                  participantId: row.participant_id,
                  actorId: row.actor_id,
                  source: row.source,
                  commandId: row.command_id,
                  recordedAt: row.recorded_at.toISOString(),
                })),
              },
            ],
            3,
            initial!.participant_id,
            replacementId,
          ],
        });
        const [currentFixture] =
          await owner`select version from fixtures where id=${initial!.id}`;
        const submittedRetirement = await officiate(as(director), lobbyId, {
          version: 1,
          commandId: createId(),
          expected: { fixture: Number(currentFixture!.version) },
          command: {
            type: 'unassign-judge',
            fixtureId: String(initial!.id),
            judgeId: nextJudge.id,
          },
        });
        assert({
          given: 'the actual submitted terminal assignment',
          should:
            'refuse retirement after its ballot and retained fixture result',
          actual: submittedRetirement,
          expected: { kind: 'refused', refusal: 'result-exists' },
        });
        // Decision67 consolidates undeployed intermediate schemas. Current records
        // retain their complete real lineage through replay and denied retirement.
        const [retained] =
          await owner`select competition_record from results where id=${answer.receipt.aggregate.id}`;
        assert({
          given:
            'the genuinely authored immutable result after replay and refused terminal retirement',
          should:
            'retain every competitive value and actual frozen assignment version unchanged',
          actual: retained!.competition_record,
          expected: record,
        });
        const [terminal] =
          await owner`select command_id,resulting_version from round_finalizations where round_id=${roundId}`;
        const [digest] =
          await owner`select daisy_ballot_content_digest(b) digest,b.submitted_at from ballots b where b.id=${submitted.ballotId}`;
        assert({
          given:
            'a genuinely finalized custom event Round and guarded result command/replay',
          should:
            'retain actual terminal identity, cast/panel/source/submission/digest while writing one effect and no private text',
          actual: {
            denied,
            kind: saved!.kind,
            roundId: saved!.round_id,
            source: record.source.judging.source,
            cast: record.cast.map(
              (person: { participantId: string }) => person.participantId,
            ),
            ballot: record.panel[0].ballot,
            freeze: record.source.freezeRevision,
            terminal: record.source.finalization,
            replay: replay.kind === 'accepted' && replay.receipt.replayed,
            private: record.panel.some(
              (row: {
                ballot: {
                  kind: string;
                  contribution?: Record<string, unknown>;
                };
              }) =>
                row.ballot.kind === 'submitted' &&
                ['reason', 'feedback', 'citations', 'privateNote'].some(
                  (key) => key in row.ballot.contribution!,
                ),
            ),
            count: (
              await owner`select count(*)::int n from results where fixture_id=${fixture!.id}`
            )[0]!.n,
          },
          expected: {
            denied: true,
            kind: 'decided',
            roundId,
            source: { kind: 'stored', id: world.copied.copyId, version: 1 },
            cast: [...competitors, judge].map((person) => person.id),
            ballot: {
              kind: 'submitted',
              ballotId: submitted.ballotId,
              contentDigest: digest!.digest,
              submittedAt: new Date(digest!.submitted_at).toISOString(),
              contribution: ballot,
            },
            freeze: frozen.freeze.revision,
            terminal: {
              commandId: terminal!.command_id,
              resultingVersion: Number(terminal!.resulting_version),
            },
            replay: true,
            private: false,
            count: 1,
          },
        });
        await proveEventBallotReleases({
          f,
          owner,
          world,
          roundId,
          competitorActorId: competitors[0]!.actorId,
        });
        const correction = {
          version: 1,
          commandId: createId(),
          expected: envelope.expected,
          command: {
            type: 'correct-result',
            fixtureId: String(fixture!.id),
            supersedesResultId: answer.receipt.aggregate.id,
            reason: 'Judge corrected the recorded decision',
            replacement: {
              kind: 'decided',
              contributions: [
                {
                  participantId: judge.id,
                  contribution: { ...ballot, winner: 'negative' },
                },
              ],
            },
          },
        };
        const raced = await Promise.all([
          send(as(director), lobbyId, correction),
          send(as(director), lobbyId, { ...correction, commandId: createId() }),
        ]);
        const rows = await owner<
          {
            id: string;
            supersedes_result_id: string | null;
            competition_record: Extract<
              ResultCompetitionRecord,
              { kind: 'decided' }
            >;
          }[]
        >`select id,supersedes_result_id,competition_record from results where fixture_id=${fixture!.id} order by recorded_at,id`;
        assert({
          given: 'concurrent complete corrections of one retained result',
          should:
            'serialize one new correction, keep original competitive history and submission provenance, and project the explicit replacement',
          actual: {
            accepted: raced.filter((row) => row.kind === 'accepted').length,
            refused: raced.filter((row) => row.kind === 'refused').length,
            count: rows.length,
            original: rows.find(
              (row) => row.id === answer.receipt.aggregate.id,
            )!.competition_record,
            latest: rows.find(
              (row) => row.supersedes_result_id === answer.receipt.aggregate.id,
            )!.competition_record.panel[0]!.ballot,
          },
          expected: {
            accepted: 1,
            refused: 1,
            count: 2,
            original: record,
            latest: {
              ...record.panel[0].ballot,
              contribution: { ...ballot, winner: 'negative' },
            },
          },
        });

        const latest = rows.find(
          (row) => row.supersedes_result_id === answer.receipt.aggregate.id,
        )!;
        const failedId = createId();
        const rollbackFailure = createAppError(
          'INVARIANT',
          'Controlled post-write rollback',
        );
        const failing = resultCommand({
          store: {
            resultCommand: (input, work) =>
              store.resultCommand(input, (session) =>
                work({
                  ...session,
                  apply: async (...args) => {
                    await session.apply(...args);
                    throw rollbackFailure;
                  },
                }),
              ),
          },
          authorize,
          now: () => new Date().toISOString(),
          newId: createId,
        });
        let rolledBack = false;
        try {
          await failing(as(director), lobbyId, {
            ...correction,
            commandId: failedId,
            command: { ...correction.command, supersedesResultId: latest.id },
          });
        } catch (error) {
          if (error !== rollbackFailure) throw error;
          rolledBack = true;
        }
        let foreignDenied = false;
        try {
          await send(as(director), world.made.get('standing-lobby')!, {
            ...envelope,
            commandId: createId(),
          });
        } catch (error) {
          if (!(error instanceof CommandDenied)) throw error;
          foreignDenied = true;
        }
        const projected =
          await owner`select s.actor_id,s.points::text,s.rank from result_speakers s where s.result_id=${answer.receipt.aggregate.id} order by s.rank`;
        assert({
          given:
            'actual result/projection/history writes followed by injected failure, plus a foreign lobby address',
          should:
            'rollback every effect, deny the foreign target and preserve exact decimal speaker projections',
          actual: {
            rolledBack,
            foreignDenied,
            results: (
              await owner`select count(*)::int n from results where fixture_id=${fixture!.id}`
            )[0]!.n,
            failedHistory: (
              await owner`select count(*)::int n from action_history where command_id=${failedId}`
            )[0]!.n,
            projected,
          },
          expected: {
            rolledBack: true,
            foreignDenied: true,
            results: 2,
            failedHistory: 0,
            projected: competitors.map((person, index) => ({
              actor_id: person.actorId,
              points: index === 0 ? '0.35' : '0.25',
              rank: index + 1,
            })),
          },
        });
        await owner.begin(async (tx) => {
          await tx`select * from public.daisy_authorization_accounts_v2(array[${director.actorId}]::text[],null::text,true)`;
          await tx`update users set deleted_at=clock_timestamp(),email=null,name='',image=null where id=${director.userId}`;
        });
        let erasedDenied = false;
        try {
          await send(as(director), lobbyId, envelope);
        } catch (error) {
          if (!(error instanceof CommandDenied)) throw error;
          erasedDenied = true;
        }
        assert({
          given:
            'the original receipt after the caller account is tombstoned under its canonical fence',
          should:
            'deny current access without changing retained competitive history',
          actual: [
            erasedDenied,
            (
              await owner`select count(*)::int n from results where fixture_id=${fixture!.id}`
            )[0]!.n,
          ],
          expected: [true, 2],
        });
      },
      { databaseUrl: scratch.url },
    );
  } finally {
    await owner.close();
    await scratch.drop();
  }
}, 60_000);
