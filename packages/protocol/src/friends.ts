import { z } from 'zod';
import { parseUsername } from './username';

/**
 * The friendship contract (ADR 0071). Commands name the other member by
 * username; the acting member always comes from the principal, never the
 * body. A relation is always the viewer's own view of one pair.
 */
const username = z.string().transform((value, context) => {
  const parsed = parseUsername(value);
  if (parsed.ok) return parsed.username;
  context.addIssue({ code: 'custom', message: 'Invalid username' });
  return z.NEVER;
});

/** Durable pair states; a declined or removed pair has no row at all. */
export const friendshipStates = ['pending', 'accepted'] as const;
export type FriendshipState = (typeof friendshipStates)[number];

/** One pair as the viewer sees it. */
export const friendRelations = [
  'none',
  'friends',
  'outgoing',
  'incoming',
] as const;
export type FriendRelation = (typeof friendRelations)[number];

/** What a friend's online status shows: presence without seat facts. */
export const friendPresences = ['online', 'away', 'offline'] as const;
export type FriendPresence = (typeof friendPresences)[number];

const command = { version: z.literal(1), username };

export const friendCommandSchemas = {
  request: z.strictObject(command),
  respond: z.strictObject({
    ...command,
    decision: z.enum(['accept', 'decline']),
  }),
  remove: z.strictObject(command),
} as const;
export type FriendRequestCommand = z.infer<typeof friendCommandSchemas.request>;
export type FriendRespondCommand = z.infer<typeof friendCommandSchemas.respond>;
export type FriendRemoveCommand = z.infer<typeof friendCommandSchemas.remove>;

export const friendCommandResultSchema = z.strictObject({
  version: z.literal(1),
  username: z.string(),
  relation: z.enum(friendRelations),
});
export type FriendCommandResult = z.infer<typeof friendCommandResultSchema>;

const count = z.number().int().nonnegative().safe();

export const friendListSchema = z.strictObject({
  version: z.literal(1),
  friends: z.array(
    z.strictObject({
      username: z.string(),
      presence: z.enum(friendPresences),
    }),
  ),
  incoming: z.array(
    z.strictObject({ username: z.string(), requestedAt: z.iso.datetime() }),
  ),
  outgoing: z.array(
    z.strictObject({ username: z.string(), requestedAt: z.iso.datetime() }),
  ),
});
export type FriendList = z.infer<typeof friendListSchema>;

/** The shell badge and lobby count: friends online and members online. */
export const onlineCountsSchema = z.strictObject({
  version: z.literal(1),
  friendsOnline: count,
  membersOnline: count,
});
export type OnlineCounts = z.infer<typeof onlineCountsSchema>;
