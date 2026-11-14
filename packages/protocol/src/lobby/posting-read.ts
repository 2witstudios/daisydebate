import { z } from 'zod';
import { idSchema } from '../primitives';
import { tabRoundRefSchema } from './lobby-read';
import type { LobbyReadCatalogue } from './read';
import { fixtureKinds } from './vocabulary';

/**
 * A tab round's posting (TAB-5.14): its published draw only, each fixture
 * with its Room and its judges. Redaction by audience is in the shapes: an
 * entrant the audience may not name is shown by initials, video is open or
 * not, and the resolution is absent until it is released.
 */

const name = z.string().trim().min(1).max(200);
const instant = z.iso.datetime();
const count = z.int().nonnegative();

/** How a posting shows an entrant: by name, or by initials to the public. */
export const shownEntrantSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('name'), name }),
  z.strictObject({
    kind: z.literal('initials'),
    initials: z.string().regex(/^(?:[A-Z]\. ?){1,4}$/),
  }),
]);
export type ShownEntrant = z.infer<typeof shownEntrantSchema>;

export const postedJudgeSchema = z.strictObject({
  name,
  chair: z.boolean(),
});
export type PostedJudge = z.infer<typeof postedJudgeSchema>;

export const postedFixtureSchema = z.strictObject({
  fixtureId: idSchema,
  kind: z.enum(fixtureKinds),
  /** Null for a bye. */
  room: z.strictObject({ roomId: idSchema, name }).nullable(),
  /** In position order. */
  entries: z
    .array(z.strictObject({ entryId: idSchema, shown: shownEntrantSchema }))
    .max(12),
  judges: z.array(postedJudgeSchema).max(9),
  /** Whether the viewer's audiences may watch this fixture's video. */
  video: z.boolean(),
});
export type PostedFixture = z.infer<typeof postedFixtureSchema>;

export const postingQuerySchema = z.strictObject({
  lobbyId: idSchema,
  tabRoundId: idSchema,
});

export const postingViewSchema = z.strictObject({
  lobbyId: idSchema,
  event: z.strictObject({ eventId: idSchema, name }),
  tabRound: tabRoundRefSchema,
  /** When the round's Rooms open, and when it started; null before then. */
  opensAt: instant,
  startedAt: instant.nullable(),
  /** Every published fixture with a Room in the round. */
  roomCount: count,
  /** This page of the published fixtures. */
  fixtures: z.array(postedFixtureSchema).max(50),
  /** Published fixtures past this page. */
  more: count,
  /** Null until the round's resolution is released. */
  resolution: z.strictObject({ text: z.string().trim().min(1) }).nullable(),
});
export type PostingView = z.infer<typeof postingViewSchema>;

export const postingReadCatalogue = {
  PostingView: { gate: ['posting.read'] },
} as const satisfies LobbyReadCatalogue<'PostingView'>;
