import { requireJudgeAssignmentAdmission } from './judge-assignment-admission';
import {
  writeLockedRoomJudge,
  type JudgeRoomMembers,
} from './room-judge-assignment-write';
import { createAppError, createRefusal } from '@daisy/errors';
import {
  idSchema,
  roundJudgeAssignmentReceiptSchema,
  type RoundJudgeAssignmentReceipt,
} from '@daisy/protocol';
import { and, eq, sql } from 'drizzle-orm';
import type { TabTransaction } from './tab/tab-transaction';
import { readAuthorizationActors } from './authorization';
import {
  requireAdmittedPrincipal,
  type ParticipantAdmission,
} from './participant-admission';
import { hydrateRoundRows, type RoundHydration } from './round-hydration';
import {
  requireFencedParticipants,
  requireSameCommand,
} from './round-command-replay';
import {
  lockedRoundVersion,
  appendRoundPhaseChanged,
} from './round-projection-writer';
import { readDatabaseTime } from './database-clock';
import { roundCommands } from './schema/round-commands';
import { roundParticipants } from './schema/round-participants';
import { roundJudgeSlots } from './schema/round-judge-assignments';
import { rounds } from './schema/rounds';
import { rooms } from './schema/rooms';
import { retireLockedRoundJudge } from './round-judge-retirement';

type AssignmentContext = {
  readonly round: RoundHydration;
  readonly room: typeof rooms.$inferSelect;
  readonly slot: typeof roundJudgeSlots.$inferSelect;
  readonly now: string;
};
/** Internal owner port; caller holds command/account/source-parent/Room fences in that order. */
export async function changeLockedRoundJudge(
  tx: TabTransaction,
  input: {
    readonly roundId: string;
    readonly roomId: string;
    readonly slot: number;
    readonly expectedVersion: number;
    readonly expectedAssignmentVersion: number | null;
    readonly nextActorId: string | null;
    readonly actorId: string;
    readonly commandId: string;
    readonly payloadDigest: string;
    readonly fencedActorIds: readonly string[];
    readonly newId: () => string;
    readonly admits: ParticipantAdmission;
    readonly members: JudgeRoomMembers;
    readonly afterChange: Parameters<
      typeof writeLockedRoomJudge
    >[1]['afterChange'];
    readonly authorize: (context: AssignmentContext) => void;
  },
): Promise<RoundJudgeAssignmentReceipt> {
  const ids = [
    input.roundId,
    input.roomId,
    input.actorId,
    input.commandId,
    ...(input.nextActorId ? [input.nextActorId] : []),
  ];
  if (
    !ids.every((id) => idSchema.safeParse(id).success) ||
    !Number.isSafeInteger(input.slot) ||
    input.slot < 0 ||
    !/^[a-f0-9]{64}$/.test(input.payloadDigest)
  )
    throw createAppError('VALIDATION');
  const current = await lockedRoundVersion(tx, input.roundId);
  const round = await hydrateRoundRows(tx, input.roundId);
  const [source] = await tx
    .select({ roomId: rounds.roomId })
    .from(rounds)
    .where(eq(rounds.id, input.roundId));
  const [room] = await tx
    .select()
    .from(rooms)
    .where(eq(rooms.id, input.roomId));
  const [slot] = await tx
    .select()
    .from(roundJudgeSlots)
    .where(
      and(
        eq(roundJudgeSlots.roundId, input.roundId),
        eq(roundJudgeSlots.slot, input.slot),
      ),
    );
  if (!round || !room || source?.roomId !== room.id || !slot)
    throw createAppError('NOT_FOUND');
  requireFencedParticipants(round.participants, input.fencedActorIds);
  if (
    ![input.actorId, ...(input.nextActorId ? [input.nextActorId] : [])].every(
      (id) => input.fencedActorIds.includes(id),
    )
  )
    throw createAppError('CONFLICT');
  const accounts = await readAuthorizationActors(tx, input.fencedActorIds, {
    maxActors: input.fencedActorIds.length,
  });
  const now = (await readDatabaseTime(tx)).toISOString();
  requireAdmittedPrincipal(input.admits, accounts, input.actorId);
  input.authorize({ round, room, slot, now });
  const [previous] = await tx
    .select()
    .from(roundCommands)
    .where(eq(roundCommands.commandId, input.commandId));
  if (previous) {
    requireSameCommand(previous, {
      roundId: input.roundId,
      actorId: input.actorId,
      serviceId: null,
      type: 'change_judge',
      payloadDigest: input.payloadDigest,
    });
    const receipt = roundJudgeAssignmentReceiptSchema.parse(previous.result);
    if (receipt.slot !== input.slot)
      throw createRefusal('CONFLICT', 'command-conflict');
    return { ...receipt, replayed: true };
  }
  if (
    current.version !== input.expectedVersion ||
    slot.currentVersion !== input.expectedAssignmentVersion
  )
    throw createRefusal('CONFLICT', 'stale-version');
  if (input.nextActorId)
    await requireJudgeAssignmentAdmission(tx, {
      actorId: input.nextActorId,
      slot: input.slot,
      accounts,
      admits: input.admits,
    });
  const participantId = input.nextActorId ? input.newId() : null;
  const receipt = roundJudgeAssignmentReceiptSchema.parse({
    kind: 'judge_assignment',
    commandId: input.commandId,
    roundId: input.roundId,
    slot: input.slot,
    assignmentVersion: (slot.currentVersion ?? 0) + 1,
    participantId,
    resultingVersion: current.version + 1,
    replayed: false,
  });
  await tx.insert(roundCommands).values({
    commandId: input.commandId,
    roundId: input.roundId,
    actorId: input.actorId,
    serviceId: null,
    type: 'change_judge',
    payloadDigest: input.payloadDigest,
    result: receipt,
    resultingVersion: receipt.resultingVersion,
    appliedAt: new Date(now),
  });
  if (participantId && input.nextActorId)
    await tx.insert(roundParticipants).values({
      id: participantId,
      roundId: input.roundId,
      actorId: input.nextActorId,
      seatKind: 'judge',
      side: null,
      slot: input.slot,
    });
  await tx.execute(
    sql`select public.daisy_append_round_judge_assignment(${input.roundId},${input.slot},${input.expectedVersion},${input.expectedAssignmentVersion},${participantId},${input.commandId})`,
  );
  await writeLockedRoomJudge(tx, {
    roomId: room.id,
    slot: input.slot,
    previousParticipantId: slot.participantId,
    next:
      participantId && input.nextActorId
        ? { id: participantId, actorId: input.nextActorId }
        : null,
    now,
    members: input.members,
    afterChange: input.afterChange,
  });
  if (slot.participantId)
    await retireLockedRoundJudge(tx, {
      roundId: round.id,
      participantId: slot.participantId,
    });
  await appendRoundPhaseChanged(tx, round.id, receipt.resultingVersion);
  return receipt;
}
