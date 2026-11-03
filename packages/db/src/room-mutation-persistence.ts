import { eq } from 'drizzle-orm';

import type { RoomAssemblyState, RoomMutationOutcome } from '@daisy/protocol';
import { freezeRoomConfig } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import { insertRoundDraw } from './room-draw-persistence';

import { rooms, roomParticipants } from './schema/rooms';
import { challenges } from './schema/challenges';
import { roundLadder, rounds } from './schema/rounds';
import { roundParticipants } from './schema/round-participants';
import { appendRoundPhaseChanged } from './round-projection-writer';
import { holdActiveRoomMembers } from './room-membership-persistence';

import {
  appendRoomChanged,
  type Tx,
  publishDefinition,
} from './room-command-facts';
import { isOpenRoomStatus } from './room-open';

/** The room row a mutation writes; the idle anchor moves only on an accepted command. */
const roomRow = (
  next: Extract<RoomMutationOutcome, { ok: true }>['mutation']['state'],
  acceptedCommand: boolean,
  now: string,
) => ({
  title: next.title,
  topic: next.topic,
  publishedResolutionId: next.publishedResolutionId,
  visibility: next.visibility,
  hostActorId: next.hostActorId,
  version: next.version,
  changeVersion: next.changeVersion,
  formatId: next.formatId,
  formatVersion: next.formatVersion,
  basisFormatId: next.basis?.formatId ?? null,
  basisPresetVersion: next.basis?.presetVersion ?? null,
  config: next.config,
  capture: next.capture,
  executionPlan: next.executionPlan,
  rulesSnapshot: next.rules,
  status: next.status,
  ...(acceptedCommand ? { lastCommandAt: new Date(now) } : {}),
  updatedAt: new Date(now),
});

export const persistRoomMutation = async (
  tx: Tx,
  mutation: Extract<RoomMutationOutcome, { ok: true }>['mutation'],
  roundId: string,
  now: string,
  /** True for an accepted participant command: it moves the idle anchor. */
  acceptedCommand: boolean,
) => {
  const next = mutation.state;
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
  await tx.delete(roomParticipants).where(eq(roomParticipants.roomId, next.id));
  if (next.participants.length)
    await tx.insert(roomParticipants).values(
      next.participants.map((p) => ({
        id: p.id,
        roomId: next.id,
        actorId: p.actorId,
        role: p.role,
        slot: p.slot,
        readinessCommandId: p.consentCommandId,
        readinessVersion: p.consentVersion,
      })),
    );
  await holdActiveRoomMembers(tx, next.id, mutation.members);
  let roundRef = next.roundRef;
  if (mutation.freeze) {
    const plan = next.executionPlan;
    const prepMs = plan.preRoundPrep.enabled
      ? plan.preRoundPrep.durationMs
      : null;
    // With nothing to run first, the Round starts at this click.
    const opens = plan.resolutionDraw.enabled || prepMs !== null;
    if (!opens && next.topic === null) throw createAppError('INVARIANT');
    await tx.insert(rounds).values({
      id: roundId,
      roomId: next.id,
      createdByActorId: next.hostActorId,
      resolution: next.topic,
      preRoundPrepMs: prepMs,
      publishedResolutionId: next.publishedResolutionId,
      competitionType: next.competitionType,
      formatId: next.formatId,
      formatVersion: next.formatVersion,
      presetVersion: next.presetVersion,
      roomConfigSnapshot: freezeRoomConfig(next.config),
      capture: next.capture,
      visibility: next.visibility,
      rulesSnapshot: next.rules,
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
        role: p.role,
        slot: p.slot,
      })),
    );
    if (mutation.draw) await insertRoundDraw(tx, roundId, mutation.draw);
    await appendRoundPhaseChanged(tx, roundId, 1);
    roundRef = { id: roundId, status: opens ? 'opening' : 'active' };
  }
  return roundRef;
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
    '',
    now,
    after.hostActorId !== before.hostActorId,
  );
  await appendRoomChanged(tx, state.id, state.changeVersion);
};
