import { createAppError, createRefusal } from '@daisy/errors';
import {
  idSchema,
  isOpenRoomStatus,
  type RoomAssemblyState,
} from '@daisy/protocol';
import { eq } from 'drizzle-orm';
import type { TabTransaction } from './tab/tab-transaction';
import { rooms } from './schema/rooms';
import { roomFacts } from './room-command-facts';
import { readAuthorizationActors } from './authorization';
import { requireFencedParticipants } from './round-command-replay';
import { readDatabaseTime } from './database-clock';
import {
  requireAdmittedPrincipal,
  type ParticipantAdmission,
} from './participant-admission';
import { requireJudgeAssignmentAdmission } from './judge-assignment-admission';
import {
  writeLockedRoomJudge,
  type JudgeRoomMembers,
} from './room-judge-assignment-write';

/** Internal ordinary owner port before Start; the caller holds its account/source/Room fences and journal. */
export async function changeLockedRoomJudge(
  tx: TabTransaction,
  input: {
    readonly roomId: string;
    readonly slot: number;
    readonly expectedVersion: number;
    readonly nextActorId: string | null;
    readonly actorId: string;
    readonly fencedActorIds: readonly string[];
    readonly newId: () => string;
    readonly admits: ParticipantAdmission;
    readonly members: JudgeRoomMembers;
    readonly afterChange: Parameters<
      typeof writeLockedRoomJudge
    >[1]['afterChange'];
    readonly authorize: (context: {
      readonly state: RoomAssemblyState;
      readonly now: string;
    }) => void;
  },
) {
  if (
    ![
      input.roomId,
      input.actorId,
      ...(input.nextActorId ? [input.nextActorId] : []),
    ].every((id) => idSchema.safeParse(id).success) ||
    !Number.isSafeInteger(input.slot) ||
    input.slot < 0
  )
    throw createAppError('VALIDATION');
  const [room] = await tx
    .select()
    .from(rooms)
    .where(eq(rooms.id, input.roomId))
    .for('no key update');
  if (!room) throw createAppError('NOT_FOUND');
  const { state } = await roomFacts(tx, room);
  requireFencedParticipants(state.participants, input.fencedActorIds);
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
  input.authorize({ state, now });
  if (room.version !== input.expectedVersion)
    throw createRefusal('CONFLICT', 'stale-version');
  if (
    !isOpenRoomStatus(room.status) ||
    input.slot >= room.rulesSnapshot.seats.judges
  )
    throw createAppError('CONFLICT');
  const prior = state.participants.find(
    (person) => person.seat.kind === 'judge' && person.seat.slot === input.slot,
  );
  if (input.nextActorId)
    await requireJudgeAssignmentAdmission(tx, {
      actorId: input.nextActorId,
      slot: input.slot,
      accounts,
      admits: input.admits,
    });
  return writeLockedRoomJudge(tx, {
    roomId: room.id,
    slot: input.slot,
    previousParticipantId: prior?.id ?? null,
    next: input.nextActorId
      ? { id: input.newId(), actorId: input.nextActorId }
      : null,
    now,
    members: input.members,
    afterChange: input.afterChange,
  });
}
