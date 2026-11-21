import { eq } from 'drizzle-orm';

import type { RoomAssemblyState, RoomMutationOutcome } from '@daisy/protocol';
import {
  emptyRuntimeCheckpointFor,
  aiBallotAdmissionRefusal,
  isJudgeSeat,
  freezePostRoundCall,
  freezeRoomConfig,
  roundBegan,
} from '@daisy/protocol';
import { createRefusal, createAppError } from '@daisy/errors';
import { insertRoundDraw } from './room-draw-persistence';

import { rooms, roomParticipants } from './schema/rooms';
import { roundDrawSeeds } from './schema/round-seeds';
import { challenges } from './schema/challenges';
import { rounds } from './schema/rounds';
import { legacyRoomCompetition, lockLadderSeason } from './ladder-season';
import { roundParticipants } from './schema/round-participants';
import { appendRoundPhaseChanged } from './round-projection-writer';
import { oweRoundStarted } from './round-began';
import { holdActiveRoomMembers } from './room-membership-persistence';
import { freezeRoomBallot } from './room-ballot-freeze';
import { columnsOfSeat } from './seat-columns';
import { refuseIneligibleDebaters } from './room-start-eligibility';
import { lobbies } from './schema/lobbies';

import {
  appendRoomChanged,
  type Tx,
  publishDefinition,
} from './room-command-facts';
import { isOpenRoomStatus } from '@daisy/protocol';
import { settleRoomInvitationsAfter } from './room-invitations/store';
import { notifyWork } from './work-wake';

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
  teamOneSide: next.teamOneSide,
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
        teamOpen: p.teamOpen,
        positionOpen: p.positionOpen,
        readinessCommandId: p.consentCommandId,
        readinessVersion: p.consentVersion,
      })),
    );
  await holdActiveRoomMembers(tx, next.id, mutation.members);
  if (mutation.freeze) {
    // The engine named the Round this Start launches, and the status it launches in.
    if (next.status !== 'started') throw createAppError('INVARIANT');
    await refuseIneligibleDebaters(tx, next);
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
    const competition = legacyRoomCompetition(next);
    if (competition.ladder) {
      const [lobby] = await tx
        .select({ organizationId: lobbies.ownerOrganizationId })
        .from(lobbies)
        .where(eq(lobbies.id, next.lobbyId));
      if (!lobby?.organizationId) throw createAppError('INVARIANT');
      await lockLadderSeason(tx, competition.ladder, lobby.organizationId);
    }
    await tx.insert(rounds).values({
      leagueLadderId: source?.leagueLadderId ?? null,
      id: roundId,
      roomId: next.id,
      createdByActorId: next.hostActorId,
      hostInherited: next.hostInherited,
      resolution: next.topic,
      preRoundPrepMs: prepMs,
      competitionType: competition.competitionType,
      formatId: next.formatId,
      formatVersion: next.formatVersion,
      presetVersion:
        competition.competitionType === 'ranked' ? next.presetVersion : null,
      roomConfigSnapshot: freezeRoomConfig(next.config),
      capture: next.capture,
      postRoundCall: freezePostRoundCall(next.postRoundCall, next.participants),
      visibility: next.visibility,
      rulesSnapshot: next.rules,
      judging,
      runtimeState: emptyRuntimeCheckpointFor(next.rules),
      seatDraw: mutation.seatDraw,
      status: opens ? 'opening' : 'active',
      ...(opens
        ? {}
        : { currentStage: 'countdown' as const, startedAt: new Date(now) }),
      ladderId: competition.ladder?.style ?? null,
      ladderDivision: competition.ladder?.division ?? null,
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
    // One seed per Round (ADR 0145): the draw's when it has one, else the seat draw's alone.
    if (mutation.draw) await insertRoundDraw(tx, roundId, mutation.draw);
    else if (mutation.roundSeed)
      await tx
        .insert(roundDrawSeeds)
        .values({ roundId, seed: mutation.roundSeed });
    await appendRoundPhaseChanged(tx, roundId, 1);
    // The live Round loops find it now, not at their idle cap (ADR 0154).
    await notifyWork(tx, 'round');
    // A Round with nothing to run first begins at this click (ADR 0144).
    if (roundBegan(null, opens ? 'opening' : 'active'))
      await oweRoundStarted(tx, { roundId, at: now });
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
      seatDraw: null,
      roundSeed: null,
      members: activeRoomMembers(state),
    },
    now,
    after.hostActorId !== before.hostActorId,
  );
  await appendRoomChanged(tx, state.id, state.changeVersion);
};
