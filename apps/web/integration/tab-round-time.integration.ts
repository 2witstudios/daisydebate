import { SQL } from 'bun';
import { requireTestServices } from '@daisy/config';
import { scratchDatabase, finishedOrBlockedBehind } from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';
import { isAppError } from '@daisy/errors';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withRoomRuntime } from './room-runtime.test-support';
import { committedEventRoom } from './tab-event-room-direction.test-support';
import { playTournamentRound } from './tab-tournament-round.test-support';
import { createRoundBallotOperations } from '../src/features/round-ballots/operations';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('trusted Round time preserves actual command receipts and samples the ballot deadline after the real Round wait', async () => {
  const scratch = scratchDatabase(databaseUrl, 'tabroundtime');
  await scratch.create();
  const owner = new SQL(scratch.url, { max: 4 });
  try {
    await scratch.migrate(() => true);
    const world = await committedEventRoom(owner, 'copy', { noPrep: true });
    let at = Date.now(),
      reads = 0;
    const clock = {
      now: () => new Date(at).toISOString(),
      advance: (minutes: number) => {
        at += minutes * 60000;
        return new Date(at).toISOString();
      },
    };
    await withRoomRuntime(
      async (f) => {
        const rooms = await owner<
          { room_id: string }[]
        >`select room_id from fixtures where tab_round_id=${world.made.get('tab-round')!} order by room_id`;
        const submit = createRoundBallotOperations({
          store: f.store,
          nextBallotId: createId,
          nextSegmentId: createId,
        });
        for (const [index, room] of rooms.entries()) {
          const cast = await owner<
            { actor_id: string; user_id: string }[]
          >`select p.actor_id,a.user_id from room_participants p join actors a on a.id=p.actor_id where p.room_id=${room.room_id}`;
          for (const person of cast) {
            const caller = { actorId: person.actor_id, userId: person.user_id };
            await f.consent(
              caller,
              await f.operations.view(caller, room.room_id),
              'ready',
            );
          }
          const director = world.bots.Director!,
            ready = await f.operations.view(director, room.room_id);
          const started = await f.operations.command(director, room.room_id, {
            type: 'start-round',
            commandId: createId(),
            expectedVersion: ready.version,
          });
          const roundId = started.receipt.roundRef!.id;
          const initial = (await f.store.getRound(roundId))!;
          at = Date.parse(initial.launchedAt);
          const frozen = await playTournamentRound(f, roundId, clock);
          const round = (await f.store.getRound(roundId))!,
            judge = round.participants.find(
              (person) => person.seat.kind === 'judge',
            )!;
          if (!judge.actorId || !round.judging)
            throw new Error(
              'Actual judge or pinned judging definition is missing',
            );
          const ballot = {
            rubricVersion:
              round.judging.ballot.key + '@' + round.judging.ballot.revision,
            winner: 'affirmative',
            scores: Object.fromEntries(
              round.participants
                .filter((person) => person.seat.kind === 'side')
                .map((person, i) => [person.id, i === 0 ? 0.35 : 0.25]),
            ),
            speakerRanks: round.participants
              .filter((person) => person.seat.kind === 'side')
              .map((person) => [person.id]),
          };
          const envelope = {
            version: 1 as const,
            commandId: createId(),
            expectedVersion: round.version,
            judgeParticipantId: judge.id,
            freezeRevision: frozen.revision,
            ballot,
          };
          const [window] = await owner<
            { ballot_deadline_at: Date }[]
          >`select ballot_deadline_at from rounds where id=${roundId}`;
          at = window!.ballot_deadline_at.getTime() - 1;
          const send = async (commandId = envelope.commandId) => {
            try {
              return {
                kind: 'accepted' as const,
                receipt: await submit.submit(
                  { kind: 'human', actorId: judge.actorId! },
                  roundId,
                  { ...envelope, commandId },
                ),
              };
            } catch (error) {
              if (!isAppError(error)) throw error;
              return { kind: 'refused' as const, reason: error.reason };
            }
          };
          if (index === 0) {
            const accepted = await send();
            const [stored] = await owner<
              { submitted_at: Date }[]
            >`select submitted_at from ballots where round_id=${roundId}`;
            assert({
              given:
                'an actual completed speech/attendance timeline and human ballot one millisecond before its immutable cutoff',
              should:
                'accept the original source unchanged and retain exactly that controlled UTC submission instant',
              actual: [accepted.kind, stored?.submitted_at.toISOString()],
              expected: ['accepted', clock.now()],
            });
          } else {
            reads = 0;
            const waiting = await owner.begin(async (tx) => {
              await tx`select id from rounds where id=${roundId} for no key update`;
              const [holder] = await tx`select pg_backend_pid() pid`;
              const result = send();
              const blocked = await finishedOrBlockedBehind(
                result,
                f.sql,
                Number(holder!.pid),
                { now: Date.now },
              );
              assert({
                given:
                  'the actual Round held while the human command arrives before cutoff',
                should:
                  'reach the genuine lock wait without sampling execution time early',
                actual: [blocked, reads],
                expected: ['blocked', 0],
              });
              at = window!.ballot_deadline_at.getTime();
              return { result };
            });
            const exact = await waiting.result;
            assert({
              given:
                'the same command after its actual lock wait crosses to the exact immutable cutoff',
              should:
                'sample once after the wait and refuse with no ballot or command receipt',
              actual: [
                exact,
                reads,
                (
                  await owner`select count(*)::int n from ballots where round_id=${roundId}`
                )[0]!.n,
                (
                  await owner`select count(*)::int n from round_commands where command_id=${envelope.commandId}`
                )[0]!.n,
              ],
              expected: [{ kind: 'refused', reason: 'round-decided' }, 1, 0, 0],
            });
            at += 1;
            assert({
              given: 'a fresh command after that same expired boundary',
              should:
                'continue to refuse without restoring or extending the window',
              actual: await send(createId()),
              expected: { kind: 'refused', reason: 'round-decided' },
            });
          }
        }
      },
      {
        databaseUrl: scratch.url,
        roundTime: async () => {
          reads += 1;
          return clock.now();
        },
      },
    );
  } finally {
    await owner.close();
    await scratch.drop();
  }
}, 90000);
