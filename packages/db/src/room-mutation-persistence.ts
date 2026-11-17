import { eq } from 'drizzle-orm';

import type { RoomAssemblyState, RoomMutationOutcome } from '@daisy/protocol';
import {
  emptyRuntimeCheckpointFor,
  aiBallotAdmissionRefusal,
  isJudgeSeat,
  freezePostRoundCall,
  freezeRoomConfig,
} from '@daisy/protocol';
import { createRefusal, createAppError } from '@daisy/errors';
import { insertRoundDraw } from './room-draw-persistence';

import { rooms, roomParticipants } from './schema/rooms';
import { challenges } from './schema/challenges';
import { roundLadder, rounds } from './schema/rounds';
import { roundParticipants } from './schema/round-participants';
import { appendRoundPhaseChanged } from './round-projection-writer';
import { holdActiveRoomMembers } from './room-membership-persistence';
import { freezeRoomBallot } from './room-ballot-freeze';
import { columnsOfSeat } from './seat-columns';

import {
  appendRoomChanged,
  type Tx,
  publishDefinition,
} from './room-command-facts';
import { isOpenRoomStatus } from '@daisy/protocol';
import { settleRoomInvitationsAfter } from './room-invitations/store';

/** The room row a mutation writes; the idle anchor moves only on an accepted command. */
const roomRow = (
  next: Extract<RoomMutationOutcome, { ok: true }>['mutation']['state'],
  acceptedCommand: boolean,
  now: string,
) => ({
  title: next.title,
  topic: next.topic,
  visibility: next.visibility,
  hostActorId: next.hostActorId,
  hostInherited: next.hostInherited,
  version: next.version,
  changeVersion: next.changeVersion,
  formatId: next.formatId,
  formatVersion: next.formatVersion,
  basisFormatId: next.basis?.formatId ?? null,
  basisPresetVersion: next.basis?.presetVersion ?? null,
  config: next.config,
  capture: next.capture,
  postRoundCall: next.postRoundCall,
  executionPlan: next.executionPlan,
  rulesSnapshot: next.rules,
  status: next.status,
  ...(acceptedCommand ? { lastCommandAt: new Date(now) } : {}),
  updatedAt: new Date(now),
});

export const persistRoomMutation = async (
  tx: Tx,
  mutation: Extract<RoomMutationOutcome, { ok: true }>['mutation'],
  now: string,
  /** True for an accepted participant command: it moves the idle anchor. */
  acceptedCommand: boolean,
) => {
  const next = mutation.state;
  const judging = mutation.freeze
    ? await freezeRoomBallot(tx, next.id, next.rules)
    : null;
  if (
    judging &&
    next.participants.some((p) => p.kind === 'bot' && isJudgeSeat(p.seat))
  ) {
    const refusal = aiBallotAdmissionRefusal(
      judging.ballot,
      next.rules,
      next.participants,
    );
    if (refusal)
      throw createRefusal('CONFLICT', 'ballot-definition-unavailable');
  }
  if (mutation.publishDefinition)
    await publishDefinition(
      tx,
      next.formatId,
      next.hostActorId,
      next.definition,
    );
  // Row lock prevents readers or other commands observing partial cast/prep/config.
  await tx
    .update(rooms)
    .set(roomRow(next, acceptedCommand, now))
    .where(eq(rooms.id, next.id));
  // ISSUE-699: a challenge invites to a room still gathering its players,
  // so it goes the moment the room is no longer open (Rooms' own vocabulary).
  if (!isOpenRoomStatus(next.status))
    await tx.delete(challenges).where(eq(challenges.roomId, next.id));
  // ADR 0124: an invitee who took their seat accepted; a Room no longer open
  // ends every invitation still waiting, and frees what it held.
  await settleRoomInvitationsAfter(tx, next, now);
  await tx.delete(roomParticipants).where(eq(roomParticipants.roomId, next.id));
  if (next.participants.length)
    await tx.insert(roomParticipants).values(
      next.participants.map((p) => ({
        id: p.id,
        roomId: next.id,
        actorId: p.actorId,
        ...columnsOfSeat(p.seat),
        readinessCommandId: p.consentCommandId,
        readinessVersion: p.consentVersion,
      })),
    );
  await holdActiveRoomMembers(tx, next.id, mutation.members);
  if (mutation.freeze) {
    // The engine named the Round this Start launches, and the status it launches in.
    if (next.status !== 'started') throw createAppError('INVARIANT');
    const plan = next.executionPlan;
    const prepMs = plan.preRoundPrep.enabled
      ? plan.preRoundPrep.durationMs
      : null;
    const roundId = next.roundRef.id;
    // With nothing to run first, the Round starts at this click.
    const opens = next.roundRef.status === 'opening';
    if (!opens && next.topic === null) throw createAppError('INVARIANT');
    const [source] = await tx
      .select({ leagueLadderId: rooms.leagueLadderId })
      .from(rooms)
      .where(eq(rooms.id, next.id));
    await tx.insert(rounds).values({
      leagueLadderId: source?.leagueLadderId ?? null,
      id: roundId,
      roomId: next.id,
      createdByActorId: next.hostActorId,
      hostInherited: next.hostInherited,
      resolution: next.topic,
      preRoundPrepMs: prepMs,
      competitionType: next.competitionType,
      formatId: next.formatId,
      formatVersion: next.formatVersion,
      presetVersion: next.presetVersion,
      roomConfigSnapshot: freezeRoomConfig(next.config),
      capture: next.capture,
      postRoundCall: freezePostRoundCall(next.postRoundCall, next.participants),
      visibility: next.visibility,
      rulesSnapshot: next.rules,
      judging,
      runtimeState: emptyRuntimeCheckpointFor(next.rules),
      status: opens ? 'opening' : 'active',
      ...(opens
        ? {}
        : { currentStage: 'countdown' as const, startedAt: new Date(now) }),
      ladderId: roundLadder(next.competitionType, next.formatId),
      createdAt: new Date(now),
      updatedAt: new Date(now),
    });
    await tx.insert(roundParticipants).values(
      next.participants.map((p) => ({
        id: p.id,
        roundId: roundId,
        actorId: p.actorId,
        ...columnsOfSeat(p.seat),
      })),
    );
    if (mutation.draw) await insertRoundDraw(tx, roundId, mutation.draw);
    await appendRoundPhaseChanged(tx, roundId, 1);
  }
  return next.roundRef;
};

/**
 * Persists a Room change made under an authority other than a command (erasure,
 * a restriction), under the caller's row lock. It freezes no Round, so it never
 * spends an AI round or seats a bot. It moves the idle anchor only when the host
 * changes: a new host must have the Room's whole idle time to act.
 */
export const persistRoomOutsideCommands = async (
  tx: Tx,
  before: RoomAssemblyState,
  after: RoomAssemblyState,
  activeRoomMembers: (room: RoomAssemblyState) => readonly string[],
  now: string,
) => {
  const state = { ...after, changeVersion: before.changeVersion + 1 };
  await persistRoomMutation(
    tx,
    {
      state,
      consent: null,
      freeze: false,
      seatsBotDebater: false,
      publishDefinition: false,
      draw: null,
      members: activeRoomMembers(state),
    },
    now,
    after.hostActorId !== before.hostActorId,
  );
  await appendRoomChanged(tx, state.id, state.changeVersion);
};
