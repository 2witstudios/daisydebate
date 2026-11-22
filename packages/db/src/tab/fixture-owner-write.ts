import { createAppError } from '@daisy/errors';
import { changeLockedRoomJudge } from '../room-judge-assignment';
import { changeLockedRoundJudge } from '../round-judge-assignment';
import { voidLockedRoundSource } from '../round-source-void';
import { assembleRoom } from '../room-assembly';
import { persistRoomOutsideCommands } from '../room-mutation-persistence';
import type { ParticipantAdmission } from '../participant-admission';
import type { JudgeRoomMembers } from '../room-judge-assignment-write';
import type { RoomAssemblyState } from '@daisy/protocol/room-contract';
import type {
  LoadedFixtureCommand,
  FixtureCommandInput,
} from './fixture-command-facts';
import type { Tx } from '../tx';

export type FixtureOwnerEffects = {
  readonly actorId: string;
  readonly commandId: string;
  readonly payloadDigest: string;
  readonly newId: () => string;
  readonly admits: ParticipantAdmission;
  readonly members: JudgeRoomMembers;
  readonly afterJudgeChange: Parameters<
    typeof changeLockedRoomJudge
  >[1]['afterChange'];
  readonly authorize: (now: string) => void;
  readonly stopProjection: Parameters<
    typeof voidLockedRoundSource
  >[1]['stopProjection'];
  readonly judgingEndReason: Parameters<
    typeof voidLockedRoundSource
  >[1]['judgingEndReason'];
  readonly restart: Parameters<typeof assembleRoom>[1] | null;
  readonly closeRoom: (state: RoomAssemblyState) => RoomAssemblyState;
};
/** Mirror a panel mutation through the ordinary owners; never edit the historical Start cast. */
export async function applyFixtureJudge(
  tx: Tx,
  loaded: LoadedFixtureCommand,
  input: FixtureCommandInput,
  effects: FixtureOwnerEffects,
) {
  const { context, roomState } = loaded;
  if (!context.room) return; // A draft has no ordinary Room owner yet.
  if (!roomState) throw createAppError('INVARIANT');
  const command = input.command;
  if (command.type === 'restart-fixture' || command.type === 'record-forfeit')
    return;
  const oldId =
    command.type === 'replace-judge'
      ? command.outJudgeId
      : command.type === 'unassign-judge'
        ? command.judgeId
        : null;
  const nextId =
    command.type === 'replace-judge'
      ? command.inJudgeId
      : command.type === 'assign-judge'
        ? command.judgeId
        : null;
  const old = oldId ? loaded.judges.find((row) => row.id === oldId) : null;
  const next = nextId ? loaded.judges.find((row) => row.id === nextId) : null;
  const prior = old
    ? roomState.participants.find(
        (person) =>
          person.actorId === old.actorId && person.seat.kind === 'judge',
      )
    : null;
  const slot = oldId
    ? prior?.seat.kind === 'judge'
      ? prior.seat.slot
      : null
    : (Array.from(
        { length: roomState.rules.seats.judges },
        (_, index) => index,
      ).find(
        (index) =>
          !roomState.participants.some(
            (person) =>
              person.seat.kind === 'judge' && person.seat.slot === index,
          ),
      ) ?? null);
  if (slot === null || (nextId && !next)) throw createAppError('CONFLICT');
  const common = {
    roomId: context.room.id,
    slot,
    actorId: effects.actorId,
    nextActorId: next?.actorId ?? null,
    fencedActorIds: context.fencedActorIds,
    newId: effects.newId,
    admits: effects.admits,
    members: effects.members,
    afterChange: effects.afterJudgeChange,
    authorize: ({ now }: { readonly now: string }) => effects.authorize(now),
  };
  if (context.round) {
    const assignment = loaded.slots.find((row) => row.slot === slot);
    if (!assignment) throw createAppError('INVARIANT');
    await changeLockedRoundJudge(tx, {
      ...common,
      roundId: context.round.id,
      commandId: effects.commandId,
      payloadDigest: effects.payloadDigest,
      expectedVersion: context.round.version,
      expectedAssignmentVersion: assignment.currentVersion,
    });
  } else
    await changeLockedRoomJudge(tx, {
      ...common,
      expectedVersion: context.room.version,
    });
}

/** Stop or invalidate the actual source, then close its Room and assemble exact pinned replacement. */
export async function restartFixtureRoom(
  tx: Tx,
  loaded: LoadedFixtureCommand,
  effects: FixtureOwnerEffects,
  newRoomId: string,
) {
  const { context, roomState } = loaded,
    plan = effects.restart;
  if (
    !context.round ||
    !context.room ||
    !roomState ||
    !plan ||
    plan.room.id !== newRoomId ||
    plan.lobby.id !== context.fixture.lobbyId ||
    plan.lobby.kind !== 'tournament'
  )
    throw createAppError('INVARIANT');
  const old = context.room;
  if (
    plan.room.hostActorId !== null ||
    old.hostActorId !== null ||
    plan.room.formatId !== old.formatId ||
    plan.room.formatVersion !== old.formatVersion ||
    plan.templateId !== old.templateId ||
    (plan.ballotDefinition?.id ?? null) !== old.ballotDefinitionId ||
    (plan.ballotDefinition?.version ?? null) !== old.ballotDefinitionVersion ||
    JSON.stringify(plan.room.rules) !== JSON.stringify(old.rulesSnapshot) ||
    JSON.stringify(plan.room.executionPlan) !==
      JSON.stringify(old.executionPlan) ||
    JSON.stringify(plan.room.config) !== JSON.stringify(old.config) ||
    JSON.stringify(plan.capture) !== JSON.stringify(old.capture) ||
    plan.postRoundCall !== old.postRoundCall ||
    plan.room.topic !== old.topic ||
    plan.room.title !== old.title ||
    plan.room.visibility !== old.visibility ||
    plan.room.competitionType !== old.competitionType ||
    plan.room.presetVersion !== old.presetVersion ||
    (plan.room.basis?.formatId ?? null) !== old.basisFormatId ||
    (plan.room.basis?.presetVersion ?? null) !== old.basisPresetVersion ||
    plan.cast?.seats.length !== roomState.participants.length ||
    roomState.participants.some(
      (person) =>
        !plan.cast?.seats.some(
          (seat) =>
            seat.actorId === person.actorId &&
            JSON.stringify(seat.seat) === JSON.stringify(person.seat),
        ),
    )
  )
    throw createAppError(
      'INVARIANT',
      'Restart changed its pinned Room or cast',
    );
  const receipt = await voidLockedRoundSource(tx, {
    roundId: context.round.id,
    expectedVersion: context.round.version,
    commandId: effects.commandId,
    actorId: effects.actorId,
    payloadDigest: effects.payloadDigest,
    fencedActorIds: context.fencedActorIds,
    authorize: ({ now }) => effects.authorize(now),
    stopProjection: effects.stopProjection,
    judgingEndReason: effects.judgingEndReason,
  });
  if (receipt.replayed) throw createAppError('INVARIANT');
  await persistRoomOutsideCommands(
    tx,
    roomState,
    effects.closeRoom(roomState),
    (state) => effects.members({ ...state, debateEnded: true }),
    loaded.checkedAt,
  );
  await assembleRoom(tx, {
    ...plan,
    legacyTournamentYouth: old.legacyTournamentYouth,
  });
}
