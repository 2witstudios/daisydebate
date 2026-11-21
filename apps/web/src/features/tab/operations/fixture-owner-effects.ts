import { participantAccess } from '@daisy/auth/authorization';
import {
  activeRoomMembers,
  afterRoomJudgeChange,
  closeRoom,
  createRoundRuntime,
  judgingJobEndReason,
} from '@daisy/debate-engine';
import type {
  LoadedFixtureCommand,
  FixtureOwnerEffects,
  FixtureWrite,
} from '@daisy/db/tab';
import type { FixtureCommand } from '@daisy/protocol/lobby/fixture-command';
import type { TabPrincipal } from '../tab-principal';
import { CommandDenied } from '../commands/run-command';
import { eligibleTournamentActors } from './tournament-participant-admission';
import { fixtureRestartRoom } from './fixture-restart-room';

/** Only newly admitted people are checked; retiring an old identity grants it nothing. */
export async function requireFixtureAdmissions(
  loaded: LoadedFixtureCommand,
  command: FixtureCommand,
  writes: readonly FixtureWrite[],
) {
  const judges = eligibleTournamentActors(loaded.context.accounts, 'judge');
  const additions = writes.flatMap((write) =>
    write.table === 'fixture_judges' && write.op === 'insert'
      ? loaded.judges
          .filter((judge) => judge.id === write.row.tournamentJudgeId)
          .map((judge) => judge.actorId)
      : [],
  );
  if (additions.some((actor) => !judges.has(actor)))
    throw new CommandDenied('judge-unavailable');
  if (command.type === 'restart-fixture') {
    const debaters = eligibleTournamentActors(
      loaded.context.accounts,
      'debater',
    );
    const participants = loaded.roomState?.participants ?? [];
    const competing = participants.filter(
      (person) => person.seat.kind !== 'judge',
    );
    if (
      participants.some(
        (person) => person.seat.kind === 'judge' && !judges.has(person.actorId),
      )
    )
      throw new CommandDenied('judge-unavailable');
    if (
      competing.some((person) => !debaters.has(person.actorId)) ||
      !(await loaded.context.debatersAllowed(
        competing.map(({ actorId }) => actorId),
        loaded.checkedAt,
      ))
    )
      throw new CommandDenied('not-found');
  }
}
/** Direct and confirmed commands call the same ordinary owners with their actual principal and original command identity. */
export function fixtureOwnerEffects(
  loaded: LoadedFixtureCommand,
  principal: TabPrincipal,
  input: {
    readonly command: FixtureCommand;
    readonly commandId: string;
    readonly payloadDigest: string;
    readonly roomId: string;
    readonly newId: () => string;
    readonly authorize: (now: string) => void;
  },
): FixtureOwnerEffects {
  if (!principal.actorId) throw new CommandDenied('not-found');
  return {
    actorId: principal.actorId,
    commandId: input.commandId,
    payloadDigest: input.payloadDigest,
    newId: input.newId,
    admits: (access) =>
      access.ageBand === 'adult' &&
      participantAccess({
        ...access,
        beta: access.beta ? { state: access.beta } : null,
      }),
    members: activeRoomMembers,
    afterJudgeChange: afterRoomJudgeChange,
    authorize: input.authorize,
    stopProjection: ({ round, now }) =>
      createRoundRuntime({ ...round, round, nextSegmentId: input.newId }).stop(
        now,
      ),
    judgingEndReason: judgingJobEndReason,
    closeRoom,
    restart:
      input.command.type === 'restart-fixture'
        ? fixtureRestartRoom(loaded, principal, input.roomId, input.newId)
        : null,
  };
}
