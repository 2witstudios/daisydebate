import { z } from 'zod';
import { idSchema } from './primitives';
import { openRoomStatuses } from './room-contract';

/** How many open Rooms one person may host at once is bounded; the read is too. */
export const maxHostedRooms = 50;

/**
 * One open Room a person hosts (TAB-6.16): hosting holds no seat, so this
 * is how a host without one finds their Rooms again. `seated` says whether
 * the host also sits in it, when their active-Room bar already leads there.
 */
const hostedRoomSchema = z.strictObject({
  id: idSchema,
  title: z.string().min(1),
  status: z.enum(openRoomStatuses),
  seated: z.boolean(),
});
export type HostedRoom = z.infer<typeof hostedRoomSchema>;

/** The open Rooms the caller hosts, newest first. */
export const hostedRoomsReadSchema = z.strictObject({
  rooms: z.array(hostedRoomSchema).max(maxHostedRooms),
});
