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
export const dayPersonSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('self') }),
  z.strictObject({ kind: z.literal('ward'), actorId: idSchema, name }),
  z.strictObject({ kind: z.literal('school_entry'), entryId: idSchema }),
]);

export const dayFixtureSchema = z.strictObject({
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

/** Where a fixture stands, as its Room and Round say. */
export const dayStateSchema = z.discriminatedUnion('kind', [
  /** The round is not drawn yet. */
  z.strictObject({ kind: z.literal('not_posted') }),
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
export const dayResultSchema = z
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

export const dayRowSchema = z.strictObject({
  person: dayPersonSchema,
  role: z.enum(['competitor', 'judge']),
  event: z.strictObject({ eventId: idSchema, name }),
  /** The entry competing; null on a judge's row. */
  entry: z
    .strictObject({
      entryId: idSchema,
      name,
      record: z.strictObject({ wins: count, losses: count }).nullable(),
    })
    .nullable(),
  tabRound: tabRoundRefSchema,
  /** For an elimination round not yet drawn: the break that fills it. */
  breaking: z
    .strictObject({
      size: z.int().positive().nullable(),
      divisions: z.array(name).max(8),
    })
    .nullable(),
  /** Null until the fixture is published. */
  fixture: dayFixtureSchema.nullable(),
  state: dayStateSchema,
  result: dayResultSchema,
  /** Null unless the viewer's audiences may watch it. */
  recording: z.strictObject({ durationMs: z.int().positive() }).nullable(),
});
export type DayRow = z.infer<typeof dayRowSchema>;

export const dayQuerySchema = z.strictObject({ lobbyId: idSchema });

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
export type DayView = z.infer<typeof dayViewSchema>;

export const dayReadCatalogue = {
  DayView: { gate: ['lobby.read'] },
} as const satisfies LobbyReadCatalogue<'DayView'>;
