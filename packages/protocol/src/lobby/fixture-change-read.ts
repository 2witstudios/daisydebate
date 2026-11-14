import { z } from 'zod';
import { idSchema } from '../primitives';
import { fixtureChangeSchema } from './command';
import type { LobbyReadCatalogue } from './read';

/**
 * `FixtureChangeList` (TAB-5.22): what each publish and each officiating
 * command did to one tab round's fixtures, newest last, cursor-paged. It is
 * not a compare-two-versions read. An official sees every change; anyone
 * else sees only the changes whose people include them or a ward, with
 * `people` cut to those.
 */

const cursorSchema = z.string().min(1).max(512);

export const fixtureChangeListQuerySchema = z.strictObject({
  tabRoundId: idSchema,
  cursor: cursorSchema.nullable(),
  limit: z.int().min(1).max(100),
});
export type FixtureChangeListQuery = z.infer<
  typeof fixtureChangeListQuerySchema
>;

const page = {
  tabRoundId: idSchema,
  changes: z.array(fixtureChangeSchema),
  nextCursor: cursorSchema.nullable(),
};

/** Every change in one tab round, as officials see it. */
const allChanges = z.strictObject({ seen: z.literal('all'), ...page });
/** The changes that touch the viewer or a ward, each naming only those people. */
const touchingChanges = z.strictObject({
  seen: z.literal('touching'),
  ...page,
});

export const fixtureChangeListSchema = z
  .discriminatedUnion('seen', [allChanges, touchingChanges])
  .refine(
    (list) =>
      list.changes.every((change) => change.tabRoundId === list.tabRoundId),
    { message: 'Every change is of the listed tab round.', path: ['changes'] },
  );
export type FixtureChangeList = z.infer<typeof fixtureChangeListSchema>;

export const fixtureChangeReadCatalogue = {
  FixtureChangeList: { gate: ['posting.read'] },
} as const satisfies LobbyReadCatalogue<'FixtureChangeList'>;
