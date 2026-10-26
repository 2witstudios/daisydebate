import { z } from 'zod';
import { idSchema, type DebateRole } from './primitives';
import type { RoomAssemblyState } from './room-contract';

/**
 * Where a user's one active Room stands (ADR 0070): still assembling, ready
 * to launch, or launched and its Round not yet over.
 */
export const activeRoomPhases = ['assembling', 'ready', 'live'] as const;
export type ActiveRoomPhase = (typeof activeRoomPhases)[number];

/** The page that holds a member: the Room while it assembles, then its Round's room. */
export const activeRoomHref = (input: {
  readonly phase: ActiveRoomPhase;
  readonly roomId: string;
  readonly roundId: string | null;
}): string =>
  input.phase === 'live'
    ? `/rounds/${input.roundId}/room`
    : `/rooms/${input.roomId}`;

const roomHref = /^\/rooms\/[a-z0-9]{24}$/;
const roundHref = /^\/rounds\/[a-z0-9]{24}\/room$/;

/** The signed-in user's own active Room, read server-side for the shell and the lobby. */
export const activeRoomSchema = z
  .strictObject({
    version: z.literal(1),
    id: idSchema,
    title: z.string().min(1),
    phase: z.enum(activeRoomPhases),
    role: z.enum(['host', 'debater', 'judge']),
    href: z.string(),
  })
  .refine((room) =>
    (room.phase === 'live' ? roundHref : roomHref).test(room.href),
  );
export type ActiveRoom = z.infer<typeof activeRoomSchema>;

export const activeRoomReadSchema = z.strictObject({
  activeRoom: activeRoomSchema.nullable(),
});
export type ActiveRoomRead = z.infer<typeof activeRoomReadSchema>;

/** Portable facts of the one Room an actor's membership names, supplied by the durable adapter. */
export type ActiveRoomFacts = Pick<RoomAssemblyState, 'status' | 'roundRef'> & {
  readonly room: {
    readonly id: string;
    readonly title: string;
    readonly hostActorId: string;
  };
  readonly seatRole: DebateRole | null;
};
