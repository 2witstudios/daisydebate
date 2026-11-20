import { z } from 'zod';
import { idSchema } from '../primitives';
import { tabRoundRefSchema } from './lobby-read';
import { postedJudgeSchema, shownEntrantSchema } from './posting-read';
import type { LobbyReadCatalogue } from './read';
import { fixtureKinds, releaseCauses } from './vocabulary';

/**
 * One person's day at one tournament, by time slot (TAB-5.14): for each slot,
 * the event, tab round, fixture and Room where they or someone they answer
 * for competes, or where they judge, with its state. A person entered in
 * several events has a row for each; a guardian's wards and a coach's school
 * entries have their own. A result carries only the parts released to the
 * viewer's audiences.
 */

const name = z.string().trim().min(1).max(200);
const instant = z.iso.datetime();
const count = z.int().nonnegative();

/** Whose row it is: the viewer's own, a ward's, or one of their school's entries. */
const dayPersonSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('self') }),
  z.strictObject({ kind: z.literal('ward'), actorId: idSchema, name }),
  z.strictObject({ kind: z.literal('school_entry'), entryId: idSchema }),
]);

const dayFixtureSchema = z.strictObject({
  fixtureId: idSchema,
  kind: z.enum(fixtureKinds),
  room: z.strictObject({ roomId: idSchema, name }).nullable(),
  /** In position order; `side` as the format names it. */
  entries: z
    .array(
      z.strictObject({
        entryId: idSchema,
        shown: shownEntrantSchema,
        side: name.nullable(),
        /** The row's own entry. */
        own: z.boolean(),
      }),
    )
    .max(12),
  judges: z.array(postedJudgeSchema).max(9),
  /** In a section: where the row's entry speaks. */
  speaks: z
    .strictObject({ position: z.int().positive(), of: z.int().positive() })
    .nullable(),
  /** When a section's topics appear; null where the resolution is shared. */
  topicAt: instant.nullable(),
});

/**
 * Where a published fixture stands, as its Room and Round say. A round not
 * drawn yet has no fixture and no state of its own: see `unpublished` below.
 */
export const dayStateSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('posted'), opensAt: instant }),
  z.strictObject({
    kind: z.literal('live'),
    phase: z.enum(['preparing', 'speaking']),
    speechesBeginAt: instant.nullable(),
  }),
  /** The speeches have ended and the panel's ballots are not all in. */
  z.strictObject({ kind: z.literal('ballots_due') }),
  z.strictObject({ kind: z.literal('over') }),
]);

/** A result, cut to the parts released to the viewer's audiences. */
const dayResultSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('withheld'),
      opensAt: z.enum(releaseCauses),
    }),
    z.strictObject({
      kind: z.literal('released'),
      decision: z.discriminatedUnion('kind', [
        z.strictObject({
          kind: z.literal('debate'),
          won: z.boolean(),
          judgesFor: count,
          judgesAgainst: count,
        }),
        z.strictObject({
          kind: z.literal('ranked'),
          rank: z.int().positive(),
          of: z.int().positive(),
        }),
      ]),
      /** Null while scores are not released to the viewer. */
      scores: z
        .strictObject({ points: z.number().min(0).max(1000) })
        .nullable(),
    }),
  ])
  .nullable();

const dayEntrySchema = z.strictObject({
  entryId: idSchema,
  name,
  record: z.strictObject({ wins: count, losses: count }).nullable(),
});

/** The row's part: a competitor's row names the entry competing; a judge's none. */
const dayRoles = {
  competitor: { role: z.literal('competitor'), entry: dayEntrySchema },
  judge: { role: z.literal('judge'), entry: z.null() },
};

/**
 * How far the tab round has come. Until the fixture is published the row has
 * no fixture, no result and no recording, and the state is `not_posted`;
 * once published it has a fixture and a published state, and no break note.
 */
const dayProgress = {
  unpublished: {
    /** For an elimination round not yet drawn: the break that fills it. */
    breaking: z
      .strictObject({
        size: z.int().positive().nullable(),
        divisions: z.array(name).max(8),
      })
      .nullable(),
    fixture: z.null(),
    state: z.strictObject({ kind: z.literal('not_posted') }),
    result: z.null(),
    recording: z.null(),
  },
  published: {
    breaking: z.null(),
    fixture: dayFixtureSchema,
    state: dayStateSchema,
    result: dayResultSchema,
    /** Null unless the viewer's audiences may watch it. */
    recording: z.strictObject({ durationMs: z.int().positive() }).nullable(),
  },
};

const dayRowCommon = {
  person: dayPersonSchema,
  event: z.strictObject({ eventId: idSchema, name }),
  tabRound: tabRoundRefSchema,
};

/** Each role at each stage of progress; no other pairing parses. */
const dayRowSchema = z.union([
  z.strictObject({
    ...dayRowCommon,
    ...dayRoles.competitor,
    ...dayProgress.unpublished,
  }),
  z.strictObject({
    ...dayRowCommon,
    ...dayRoles.competitor,
    ...dayProgress.published,
  }),
  z.strictObject({
    ...dayRowCommon,
    ...dayRoles.judge,
    ...dayProgress.unpublished,
  }),
  z.strictObject({
    ...dayRowCommon,
    ...dayRoles.judge,
    ...dayProgress.published,
  }),
]);
export type DayRow = z.infer<typeof dayRowSchema>;

export const dayViewSchema = z.strictObject({
  lobbyId: idSchema,
  asOf: instant,
  /** In order; a slot with nothing for the viewer is left out. */
  slots: z
    .array(
      z.strictObject({
        timeSlotId: idSchema,
        name,
        startsAt: instant,
        rows: z.array(dayRowSchema).min(1).max(32),
      }),
    )
    .max(64),
});

export const dayReadCatalogue = {
  DayView: { gate: ['lobby.read'] },
} as const satisfies LobbyReadCatalogue<'DayView'>;
