import { z } from 'zod';
import { memberStatuses } from './presence-setting';
import { idSchema } from './primitives';
import { usernameSchema as username } from './username';

/**
 * The friendship contract (ADR 0072). Commands name the other member by
 * username; the acting member always comes from the principal, never the
 * body. A relation is always the viewer's own view of one pair.
 */

/** Durable pair states; a declined or removed pair has no row at all. */
export const storedFriendshipStates = ['pending', 'accepted'] as const;

/** The command model includes pending requests that await a private hold. */
export const friendshipStates = [
  ...storedFriendshipStates,
  'waiting-for-guardian',
] as const;
export type FriendshipState = (typeof friendshipStates)[number];

/** One pair as the viewer sees it. */
const friendRelations = [
  'none',
  'friends',
  'outgoing',
  'incoming',
  'waiting',
  'waiting-for-guardian',
] as const;
export type FriendRelation = (typeof friendRelations)[number];

const command = { version: z.literal(1), username };

export const friendCommandSchemas = {
  request: z.strictObject(command),
  respond: z.strictObject({
    ...command,
    decision: z.enum(['accept', 'decline']),
  }),
  remove: z.strictObject(command),
} as const;

export const friendCommandResultSchema = z.strictObject({
  version: z.literal(1),
  username: z.string(),
  relation: z.enum(friendRelations),
});
export type FriendCommandResult = z.infer<typeof friendCommandResultSchema>;

const count = z.number().int().nonnegative().safe();

const friendRequest = z.strictObject({
  username: z.string(),
  requestedAt: z.iso.datetime(),
  waiting: z.enum(['waiting', 'waiting-for-guardian']).optional(),
});

export const friendListSchema = z.strictObject({
  version: z.literal(1),
  friends: z.array(
    z.strictObject({
      username: z.string(),
      presence: z.enum(memberStatuses),
      /** The label they chose besides the username (ADR 0143), or null. */
      displayName: z.string().nullable(),
      /** Their published profile photo, or null. */
      photoId: idSchema.nullable(),
    }),
  ),
  incoming: z.array(friendRequest),
  outgoing: z.array(friendRequest),
});
export type FriendList = z.infer<typeof friendListSchema>;

/** The shell badge: friends online. */
export const onlineCountsSchema = z.strictObject({
  version: z.literal(1),
  friendsOnline: count,
});
export type OnlineCounts = z.infer<typeof onlineCountsSchema>;
