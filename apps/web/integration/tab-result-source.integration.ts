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
import { isDebatingSeat, seatOrder } from '@daisy/protocol';
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
import { createAppError } from '@daisy/errors';
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
        // Bounded storage/command proof: existing elapsed-time and attendance
        // fixtures are explicit; this is not the full availability/media journey.
        await playOut(f, roundId, false);
        const frozen = await finalizeAsWeb(f, roundId);
        if (frozen.status !== 'frozen')
          throw new Error(`Expected real freeze, got ${frozen.status}`);
        await seedSettledAttendanceLedger(f, roundId);
        const round = (await f.store.getRound(roundId))!;
        const judge = round.participants.find(
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
        const submitted = await submit.submit(
          { kind: 'human', actorId: judge.actorId },
          roundId,
          {
            version: 1,
            commandId: createId(),
            expectedVersion: round.version,
            judgeParticipantId: judge.id,
            freezeRevision: frozen.freeze.revision,
            ballot,
          },
        );
        await finalizeByMaintenance(f, roundId);
        const [fixture] =
          await owner`select id,version from fixtures where room_id=${world.roomId}`;
        const store = createTabStore(committingRuntimeTestDatabase(owner));
        const send = resultCommand({
          store,
          authorize,
          now: () => new Date().toISOString(),
          newId: createId,
          confirmationExpiresAt: (now) =>
            new Date(Date.parse(now) + 60_000).toISOString(),
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
          confirmationExpiresAt: (now) =>
            new Date(Date.parse(now) + 60_000).toISOString(),
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
