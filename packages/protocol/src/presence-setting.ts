import { z } from 'zod';
import { ratingLadders } from './primitives';

/**
 * The status a member chooses (ADR 0097). `offline` is appearing offline.
 * Away and being in a room or a Round are never chosen: they follow what the
 * member is doing.
 */
export const chosenStatuses = ['online', 'busy', 'offline'] as const;
export type ChosenStatus = (typeof chosenStatuses)[number];

/** Everything anyone can show for a member, one vocabulary everywhere. */
export const memberStatuses = [
  'online',
  'away',
  'busy',
  'room',
  'round',
  'offline',
] as const;
export type MemberStatus = (typeof memberStatuses)[number];

export const presenceSettingSchema = z.strictObject({
  version: z.literal(1),
  status: z.enum(chosenStatuses),
});

export const presenceSettingResultSchema = z.strictObject({
  version: z.literal(1),
  status: z.enum(chosenStatuses),
});
export type PresenceSetting = z.infer<typeof presenceSettingResultSchema>;

/** Which ratings a member's card shows besides Freestyle (ADR 0097). */
export const ratingVisibilitySchema = z.strictObject({
  version: z.literal(1),
  showPolicy: z.boolean(),
  showValue: z.boolean(),
});
export type RatingVisibility = z.infer<typeof ratingVisibilitySchema>;

const count = z.number().int().nonnegative().safe();

/** One rating a member shows; null is a ladder they have not played. */
const shownRatingSchema = z.strictObject({
  ladder: z.enum(ratingLadders),
  rating: z.number().int().nullable(),
  provisional: z.boolean(),
});

/** One person on the online list, as this viewer may see them. */
const onlineMemberSchema = z.strictObject({
  username: z.string(),
  status: z.enum(memberStatuses),
  relation: z.enum(['none', 'friends', 'outgoing', 'incoming']),
  ratings: z.array(shownRatingSchema).min(1).max(3),
  wins: count,
  losses: count,
});
export type OnlineMember = z.infer<typeof onlineMemberSchema>;

/** Whom an online read lists: everyone, or the reader's friends. */
export const onlineFilters = ['all', 'friends'] as const;
export type OnlineFilter = (typeof onlineFilters)[number];

export const onlineQuerySchema = z.strictObject({
  filter: z.enum(onlineFilters).default('all'),
  q: z.string().trim().max(32).optional(),
  cursor: z.string().max(256).optional(),
});

/** One page of who is online, friends first, for this viewer (ADR 0097). */
export const onlineRosterSchema = z.strictObject({
  version: z.literal(1),
  members: z.array(onlineMemberSchema).max(100),
  nextCursor: z.string().nullable(),
  counts: z.strictObject({ everyone: count, friends: count }),
  /** The viewer's own status now, so their avatar is never a guess. */
  self: z.enum(memberStatuses),
});
export type OnlineRoster = z.infer<typeof onlineRosterSchema>;
