import { z } from 'zod';
import { memberStatuses } from './presence-setting';
import { idSchema } from './primitives';
import { ladderSchema, ratingDivisions } from './ladder';

const count = z.number().int().nonnegative().safe();

/** One rating a member shows; null is a ladder they have not played. */
const shownRatingSchema = z.strictObject({
  /** The ladder: a style in a division (ADR 0147). */
  ladder: ladderSchema,
  rating: z.number().int().nullable(),
  provisional: z.boolean(),
  /** A judge may not see this debater's rating before their ballot. */
  hidden: z.boolean(),
});

/** One person on the list, online or offline, as this viewer may see them. */
const personSchema = z.strictObject({
  username: z.string(),
  /** The label they chose besides the username (ADR 0143), or null. */
  displayName: z.string().nullable(),
  /** Their published profile photo, or null. */
  photoId: idSchema.nullable(),
  status: z.enum(memberStatuses),
  relation: z.enum(['none', 'friends', 'outgoing', 'incoming']),
  /** One per Daisy ladder (style and division). */
  ratings: z.array(shownRatingSchema).min(1).max(4),
  /**
   * The division they are rated on this season (ADR 0147), when their ratings
   * name exactly one; null when unknown. A ladder, never an age.
   */
  division: z.enum(ratingDivisions).nullable(),
  wins: count,
  losses: count,
});
export type Person = z.infer<typeof personSchema>;

/** Whom the people list shows: everyone, or the reader's friends. */
const peopleFilters = ['all', 'friends'] as const;
export type PeopleFilter = (typeof peopleFilters)[number];

export const peopleQuerySchema = z.strictObject({
  filter: z.enum(peopleFilters).default('all'),
  q: z.string().trim().max(32).optional(),
  cursor: z.string().max(256).optional(),
});

/** One page of the people list, friends first, for this viewer (ADR 0105). */
export const peopleListSchema = z.strictObject({
  version: z.literal(1),
  people: z.array(personSchema).max(100),
  nextCursor: z.string().nullable(),
  counts: z.strictObject({ everyone: count, friends: count, online: count }),
  /** The viewer's own status now, so their avatar is never a guess. */
  self: z.enum(memberStatuses),
});
export type PeopleList = z.infer<typeof peopleListSchema>;
