import { eq } from 'drizzle-orm';

import type { RoomMutationOutcome } from '@daisy/protocol';

import { rooms, roomParticipants } from './schema/rooms';
import { rounds } from './schema/rounds';
import { roundParticipants } from './schema/round-participants';

import { type Tx, publishDefinition } from './room-command-facts';
export const persistRoomMutation = async (
  tx: Tx,
  mutation: Extract<RoomMutationOutcome, { ok: true }>['mutation'],
  roundId: string,
  now: string,
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
    .set({
      title: next.title,
      topic: next.topic,
      visibility: next.visibility,
      version: next.version,
      changeVersion: next.changeVersion,
      formatId: next.formatId,
      formatVersion: next.formatVersion,
      config: next.config,
      executionPlan: next.executionPlan,
      rulesSnapshot: next.rules,
      status: next.status,
      prepStartedAt: next.prepStartedAt ? new Date(next.prepStartedAt) : null,
      prepRemainingMs: next.prepRemainingMs,
      updatedAt: new Date(now),
    })
    .where(eq(rooms.id, next.id));
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
  let roundRef = next.roundRef;
  if (mutation.freeze) {
    await tx.insert(rounds).values({
      id: roundId,
      roomId: next.id,
      createdByActorId: next.hostActorId,
      resolution: next.topic,
      competitionType: next.competitionType,
      length: next.length,
      formatId: next.formatId,
      formatVersion: next.formatVersion,
      presetVersion: next.presetVersion,
      roomConfigSnapshot: next.config,
      visibility: next.visibility,
      rulesSnapshot: next.rules,
      status: 'scheduled',
      ladderId:
        next.competitionType === 'ranked'
          ? next.length === 'full'
            ? 'ranked'
            : 'quick'
          : null,
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
    roundRef = { id: roundId, status: 'scheduled' };
  }
  return roundRef;
};
