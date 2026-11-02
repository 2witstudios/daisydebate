import { z } from 'zod';
import { idSchema } from './primitives';
import { usernameSchema as username } from './username';

/** A challenge is ranked or casual, like a game of chess (ADR 0098). */
export const challengeModes = ['ranked', 'casual'] as const;
export type ChallengeMode = (typeof challengeModes)[number];
export const challengeFormats = ['freestyle', 'policy', 'value'] as const;
export type ChallengeFormat = (typeof challengeFormats)[number];

export const challengeCommandSchemas = {
  send: z.strictObject({
    version: z.literal(1),
    commandId: idSchema,
    username,
    mode: z.enum(challengeModes),
    format: z.enum(challengeFormats),
  }),
  /** Records the room the acceptor just opened for this challenge. */
  accept: z.strictObject({
    version: z.literal(1),
    challengeId: idSchema,
    roomId: idSchema,
  }),
  decline: z.strictObject({ version: z.literal(1), challengeId: idSchema }),
  cancel: z.strictObject({ version: z.literal(1), challengeId: idSchema }),
} as const;

export const challengeResultSchema = z.strictObject({
  version: z.literal(1),
  challengeId: idSchema,
  state: z.enum(['sent', 'accepted', 'declined', 'cancelled']),
});
export type ChallengeResult = z.infer<typeof challengeResultSchema>;

const challengeSummary = {
  id: idSchema,
  username: z.string(),
  mode: z.enum(challengeModes),
  format: z.enum(challengeFormats),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
};

/** What is waiting on this member, and what they are waiting on. */
export const challengeListSchema = z.strictObject({
  version: z.literal(1),
  incoming: z.array(z.strictObject(challengeSummary)).max(20),
  outgoing: z.array(z.strictObject(challengeSummary)).max(20),
  /** Accepted, room still open: where the member should go now. */
  accepted: z
    .array(z.strictObject({ ...challengeSummary, roomId: idSchema }))
    .max(20),
});
export type ChallengeList = z.infer<typeof challengeListSchema>;
