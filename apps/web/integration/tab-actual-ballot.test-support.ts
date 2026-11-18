import type { SQL } from 'bun';
import type { Ballot, BallotWrittenRecord } from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import { withRoomRuntime } from './room-runtime.test-support';
import { playTournamentRound } from './tab-tournament-round.test-support';
import { createRoundBallotOperations } from '../src/features/round-ballots/operations';
import { scriptClock } from './tab-tournament.test-support';
import type { committedEventRoom } from './tab-event-room-direction.test-support';

/** Actual original copied pin, Ready/Start/attendance/freeze/submit; only competitive execution time is controlled. */
export async function withActualCopiedBallot(
  input: {
    readonly ballot?: Ballot;
    readonly written?: BallotWrittenRecord;
    readonly beforeSubmission?: (input: {
      readonly roundId: string;
      readonly submit: () => Promise<{ readonly ballotId: string }>;
    }) => Promise<void>;
    readonly owner: SQL;
    readonly databaseUrl: string;
    readonly world: Pick<
      Awaited<ReturnType<typeof committedEventRoom>>,
      'roomId' | 'bots'
    >;
  },
  work: (value: {
    readonly runtime: Parameters<Parameters<typeof withRoomRuntime>[0]>[0];
    readonly roundId: string;
    readonly ballotId: string;
    readonly replay: () => Promise<{ readonly ballotId: string }>;
  }) => Promise<void>,
) {
  const { owner, world } = input;
  let clock = scriptClock(Date.now());
  await withRoomRuntime(
    async (runtime) => {
      const cast = await owner<
        { actor_id: string; user_id: string }[]
      >`select p.actor_id,a.user_id from room_participants p join actors a on a.id=p.actor_id where p.room_id=${world.roomId}`;
      for (const person of cast) {
        const caller = { actorId: person.actor_id, userId: person.user_id };
        await runtime.consent(
          caller,
          await runtime.operations.view(caller, world.roomId),
          'ready',
        );
      }
      const ready = await runtime.operations.view(
        world.bots.Director!,
        world.roomId,
      );
      const started = await runtime.operations.command(
        world.bots.Director!,
        world.roomId,
        {
          type: 'start-round',
          commandId: createId(),
          expectedVersion: ready.version,
        },
      );
      const roundId = started.receipt.roundRef!.id;
      clock = scriptClock(
        Date.parse((await runtime.store.getRound(roundId))!.launchedAt),
      );
      const frozen = await playTournamentRound(runtime, roundId, clock);
      const round = (await runtime.store.getRound(roundId))!,
        judge = round.participants.find(
          (person) => person.seat.kind === 'judge',
        );
      if (!judge?.actorId || !round.judging)
        throw new Error('The genuine assigned judge or pin is missing');
      const ballot = input.ballot ?? {
        ...input.written,
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
      const operations = createRoundBallotOperations({
        store: runtime.store,
        nextBallotId: createId,
        nextSegmentId: createId,
      });
      const envelope = {
        version: 1 as const,
        commandId: createId(),
        expectedVersion: round.version,
        judgeParticipantId: judge.id,
        freezeRevision: frozen.revision,
        ballot,
      };
      const submit = () =>
        operations.submit(
          { kind: 'human', actorId: judge.actorId! },
          roundId,
          envelope,
        );
      await input.beforeSubmission?.({ roundId, submit });
      const submitted = await submit();
      await work({
        runtime,
        roundId,
        ballotId: submitted.ballotId,
        replay: submit,
      });
    },
    { databaseUrl: input.databaseUrl, roundTime: async () => clock.now() },
  );
}
