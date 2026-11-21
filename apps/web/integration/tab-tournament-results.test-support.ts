import { instantMs, nowMs } from '@daisy/clock';
import { readParticipantTournament } from '../src/features/tab/reads/participant-tournament';
import { authorize } from '@daisy/auth/authorization';
import { createTabStore } from '@daisy/db/tab';
import { isAppError } from '@daisy/errors';
import { isDebatingSeat, seatOrder } from '@daisy/protocol';
import { hostRoundViewSchema } from '@daisy/protocol/lobby/draw-read';
import { createId } from '@paralleldrive/cuid2';
import { assert } from 'riteway/bun';
import { createRoundBallotOperations } from '../src/features/round-ballots/operations';
import { readHostRound } from '../src/features/tab/reads/host-round';
import { withRoomRuntime } from './room-runtime.test-support';
import { fixtureBallot } from './round-judging.test-support';
import { as } from './tab-tournament-organization-wiring.test-support';
import { playTournamentRound } from './tab-tournament-round.test-support';
import {
  tabLobbyCommand,
  tabRead,
} from './tab-tournament-transport.test-support';
import { scriptClock, type World } from './tab-tournament.test-support';

/** Actual committed owner composition with an explicit trusted UTC resource; native media and staging are separately qualified. */
export async function resultsStage(
  world: World,
  checkParticipantViews = false,
) {
  if (!world.runtimeDatabaseUrl)
    throw new Error(
      'The tournament needs its isolated committed runtime resource',
    );
  const director = world.bots.Director!,
    lobbyId = world.made.get('tournament-lobby')!;
  const store = createTabStore(world.database);
  const send = tabLobbyCommand(world, 'fixtureResult');
  const address = {
    eventId: world.made.get('event')!,
    roundId: world.made.get('tab-round')!,
  };
  const postingFor = async (actorId: string, fixtureId: string) => {
    const person = Object.values(world.bots).find(
      (bot) => bot.actorId === actorId,
    );
    if (!person)
      throw new Error('The assigned participant cannot read their posting');
    const posting = await readParticipantTournament(
      store,
      as(person),
      lobbyId,
      address,
    );
    return posting?.selected?.fixtures.find(
      (fixture) => fixture.fixtureId === fixtureId,
    );
  };
  const fixtures = await world.sql<
    { id: string; room_id: string; version: number }[]
  >`select id,room_id,version from fixtures where tab_round_id=${world.made.get('tab-round')!} order by room_id`;
  const execution = { clock: scriptClock(Date.now()) };
  await withRoomRuntime(
    async (f) => {
      const ballots = createRoundBallotOperations({
        store: f.store,
        nextBallotId: createId,
        nextSegmentId: createId,
      });
      for (const [fixtureIndex, fixture] of fixtures.entries()) {
        const cast = await world.sql<
          { actor_id: string; user_id: string }[]
        >`select p.actor_id,a.user_id from room_participants p join actors a on a.id=p.actor_id where p.room_id=${fixture.room_id}`;
        if (checkParticipantViews) {
          const waiting = await postingFor(cast[0]!.actor_id, fixture.id);
          assert({
            given: 'a real published and seated waiting Room',
            should:
              'offer its stored Room to its assigned participant before Launch',
            actual: [
              waiting?.roomId,
              waiting?.own,
              waiting?.waiting,
              waiting?.live,
            ],
            expected: [fixture.room_id, true, true, false],
          });
        }
        for (const person of cast) {
          const caller = { actorId: person.actor_id, userId: person.user_id };
          await f.consent(
            caller,
            await f.operations.view(caller, fixture.room_id),
            'ready',
          );
        }
        const ready = await f.operations.view(director, fixture.room_id);
        const started = await f.operations.command(director, fixture.room_id, {
          type: 'start-round',
          commandId: createId(),
          expectedVersion: ready.version,
        });
        const roundId = started.receipt.roundRef!.id;
        if (checkParticipantViews) {
          const live = await postingFor(cast[0]!.actor_id, fixture.id);
          assert({
            given: 'the same Room after its canonical Launch',
            should: 'project its live state from the stored Round',
            actual: [live?.roomId, live?.waiting, live?.live],
            expected: [fixture.room_id, false, true],
          });
        }
        execution.clock = scriptClock(
          instantMs((await f.store.getRound(roundId))!.launchedAt),
        );
        const frozen = await playTournamentRound(f, roundId, execution.clock);
        const round = (await f.store.getRound(roundId))!;
        const judge = round.participants.find(
          (person) => person.seat.kind === 'judge',
        )!;
        if (!judge.actorId)
          throw new Error('The actual assigned human judge is missing');
        if (checkParticipantViews) {
          const due = await postingFor(judge.actorId, fixture.id);
          assert({
            given:
              'the assigned judge after the canonical debate and capture freeze',
            should:
              'show their ballot as due while the Round awaits submission',
            actual: [due?.roomId, due?.own, due?.ballotDue],
            expected: [fixture.room_id, true, true],
          });
        }
        const competitors = round.participants
          .filter((person) => isDebatingSeat(person.seat))
          .sort((a, b) => seatOrder(round.rules.sides)(a.seat, b.seat));
        const ballot = fixtureBallot(
          'The affirmative answered the central objection.',
        );
        const submission = {
          version: 1,
          commandId: createId(),
          expectedVersion: round.version,
          judgeParticipantId: judge.id,
          freezeRevision: frozen.revision,
          ballot,
        } as const;
        const submitted = await ballots.submit(
          { kind: 'human', actorId: judge.actorId },
          roundId,
          submission,
        );
        const waiting = await tabRead(
          world,
          'host-round',
          hostRoundViewSchema,
          readHostRound({ store, authorize }),
          (input) => ({ ...input }),
        )(as(director), {
          lobbyId,
          eventId: world.made.get('event')!,
          tabRoundId: world.made.get('tab-round')!,
        });
        const awaiting =
          waiting?.kind === 'published'
            ? waiting.round.open.find((row) => row.fixtureId === fixture.id)
            : null;
        assert({
          given:
            'an actual completed native Round with a submitted ballot before Tab records its result',
          should: 'show awaiting-result with the actual Room link',
          actual: [awaiting?.state.kind, awaiting?.room?.roomId],
          expected: ['awaiting_result', fixture.room_id],
        });
        const recorded = await send(as(director), lobbyId, {
          version: 1,
          commandId: createId(),
          expected: { fixture: Number(fixture.version) },
          command: { type: 'record-decided-result', fixtureId: fixture.id },
        });
        if (recorded.kind !== 'accepted')
          throw new Error(
            `Actual scripted result refused: ${JSON.stringify(recorded)}`,
          );
        const [saved] =
          await world.sql`select competition_record from results where id=${recorded.receipt.aggregate.id}`;
        assert({
          given:
            'the current genuine human judge submitting after real Ready/Start/check-in/yield/freeze',
          should:
            'record the exact actual frozen contribution and cast in one result without fabricated aggregate outcomes',
          actual: [
            submitted.outcome?.kind,
            saved!.competition_record.source.roundId,
            saved!.competition_record.cast
              .map((person: { participantId: string }) => person.participantId)
              .sort(),
            saved!.competition_record.panel[0].ballot.kind,
          ],
          expected: [
            'winner',
            roundId,
            [...competitors, judge].map((person) => person.id).sort(),
            'submitted',
          ],
        });
        world.made.set(`result:${fixture.id}`, recorded.receipt.aggregate.id);
        if (fixtureIndex === 0) {
          const [deadline] = await world.sql<
            { ballot_deadline_at: Date }[]
          >`select ballot_deadline_at from rounds where id=${roundId}`;
          execution.clock.advance(31);
          if (nowMs(execution.clock) <= deadline!.ballot_deadline_at.getTime())
            throw new Error(
              'The controlled late ballot did not actually miss its persisted window',
            );
          const lateId = createId();
          let lateReason: string | null = null;
          try {
            await ballots.submit(
              { kind: 'human', actorId: judge.actorId },
              roundId,
              {
                ...submission,
                commandId: lateId,
                expectedVersion: (await f.store.getRound(roundId))!.version,
                ballot: { ...ballot, winner: 'negative' },
              },
            );
          } catch (error) {
            if (!isAppError(error)) throw error;
            lateReason = error.reason ?? null;
          }
          const replay = await ballots.submit(
            { kind: 'human', actorId: judge.actorId },
            roundId,
            submission,
          );
          assert({
            given:
              'an extra changed ballot genuinely after the persisted thirty-minute window and completed original panel',
            should:
              'refuse a new receipt while acknowledging only the immutable original receipt on replay',
            actual: [
              lateReason,
              (
                await world.sql`select count(*)::int n from ballots where round_id=${roundId}`
              )[0]!.n,
              (
                await world.sql`select count(*)::int n from round_commands where command_id=${lateId}`
              )[0]!.n,
              replay,
            ],
            expected: ['round-decided', 1, 0, submitted],
          });
          const correctionId = createId();
          const corrected = await send(as(director), lobbyId, {
            version: 1,
            commandId: correctionId,
            expected: { fixture: Number(fixture.version) },
            command: {
              type: 'correct-result',
              fixtureId: fixture.id,
              supersedesResultId: recorded.receipt.aggregate.id,
              reason:
                'The late replacement ballot cannot rewrite the Round; the host records the corrected decision explicitly.',
              replacement: {
                kind: 'decided',
                contributions: [
                  {
                    participantId: judge.id,
                    contribution: {
                      ...saved!.competition_record.panel[0].ballot.contribution,
                      winner: 'negative',
                    },
                  },
                ],
              },
            },
          });
          if (corrected.kind !== 'accepted')
            throw new Error(
              `Actual scripted correction refused: ${JSON.stringify(corrected)}`,
            );
          const [correction] =
            await world.sql`select supersedes_result_id,competition_record,correction_reason from results where id=${corrected.receipt.aggregate.id}`;
          const [original] =
            await world.sql`select competition_record from results where id=${recorded.receipt.aggregate.id}`;
          const [history] =
            await world.sql`select actor_user_id,type from action_history where command_id=${correctionId}`;
          assert({
            given:
              'the actual Director correcting through an append-only complete replacement after the refused late submission',
            should:
              'keep the original real contribution/source, retain the explicit supersession reason and audit the actual account',
            actual: [
              original!.competition_record,
              correction!.supersedes_result_id,
              correction!.competition_record.panel[0].ballot.contribution
                .winner,
              correction!.correction_reason.length > 0,
              history!.actor_user_id,
              history!.type,
              (
                await world.sql`select count(*)::int n from results where fixture_id=${fixture.id}`
              )[0]!.n,
            ],
            expected: [
              saved!.competition_record,
              recorded.receipt.aggregate.id,
              'negative',
              true,
              director.userId,
              'correct-result',
              2,
            ],
          });
          world.made.set(
            `original-result:${fixture.id}`,
            recorded.receipt.aggregate.id,
          );
          world.made.set(
            `result:${fixture.id}`,
            corrected.receipt.aggregate.id,
          );
        }
      }
    },
    {
      databaseUrl: world.runtimeDatabaseUrl,
      roundTime: async () => execution.clock.now(),
    },
  );
}
