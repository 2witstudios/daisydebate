import { z } from 'zod';
import { idSchema } from '../primitives';
import type { LobbyReadCatalogue } from './read';
import { entryStatuses, judgeStrikeSources } from './vocabulary';

/**
 * The reads of a tournament's entries and judges (TAB-5.13) and of one
 * school's or family's own entries (TAB-5.14). A host sees who is entered,
 * by whom, and each judge's availability by time slot; contact details are
 * never part of any of them, so no field can carry one.
 */

const nameSchema = z.string().trim().min(1).max(200);
const countSchema = z.int().min(0);

/** An event as the reads name it: its name, and the short label a schedule shows. */
export const entryEventSchema = z.strictObject({
  id: idSchema,
  name: nameSchema,
  label: nameSchema.nullable(),
});

/** Who answers for a group of entries, and the adult who entered them. */
const responsibleGroupSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('school'),
    organizationId: idSchema,
    name: nameSchema,
    adultName: nameSchema,
  }),
  z.strictObject({
    kind: z.literal('guardian'),
    /** The family's name, as the guardian gave it. */
    name: nameSchema,
    adultName: nameSchema,
  }),
  z.strictObject({ kind: z.literal('self') }),
]);

/** A listed entry. A withdrawn entry is not listed. */
const listedEntrySchema = z.strictObject({
  id: idSchema,
  name: nameSchema,
  status: z.enum(entryStatuses).exclude(['withdrawn']),
  rating: z.int().min(0).nullable(),
  /** The events this entrant is entered in across the tournament. */
  events: z.array(entryEventSchema).min(1),
  /** A minor's age, and the guardian who manages their account, if any. */
  minor: z
    .strictObject({
      age: z.int().min(0).max(17),
      managedBy: nameSchema.nullable(),
    })
    .nullable(),
  /** Present while the person entered has no Daisy account yet. */
  invitation: z.strictObject({ invitedAt: z.iso.datetime() }).nullable(),
});

const entryGroupSchema = z.strictObject({
  responsible: responsibleGroupSchema,
  entryCount: countSchema,
  judgesOwed: countSchema,
  judgesNamed: countSchema,
  /** The first entries of the group; `entryCount` counts them all. */
  entries: z.array(listedEntrySchema),
});

/** A tournament's entries for its host, grouped by who answers for them. */
export const entryListViewSchema = z.strictObject({
  lobbyId: idSchema,
  /** The event the host is looking at. */
  eventId: idSchema,
  /** When the read was made; relative times are counted from it. */
  asOf: z.iso.datetime(),
  counts: z.strictObject({
    accepted: countSchema,
    pending: countSchema,
    judges: countSchema,
    rooms: countSchema,
    judgesNeeded: countSchema,
  }),
  groups: z.array(entryGroupSchema),
  groupsNotShown: countSchema,
  capabilities: z.strictObject({ manageEntries: z.boolean() }),
});
export type EntryListView = z.infer<typeof entryListViewSchema>;
export type ListedEntry = z.infer<typeof listedEntrySchema>;
export type EntryGroup = z.infer<typeof entryGroupSchema>;

/** One judge in one time slot. */
const judgeSlotSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('judged') }),
  z.strictObject({ state: z.literal('away') }),
  z.strictObject({ state: z.literal('free') }),
  z.strictObject({ state: z.literal('in_draft') }),
  /** Judging now: a Room's name, or another event's name. */
  z.strictObject({
    state: z.literal('judging'),
    place: nameSchema,
    late: z.boolean(),
  }),
]);
export type JudgeSlot = z.infer<typeof judgeSlotSchema>;

const listedJudgeSchema = z.strictObject({
  id: idSchema,
  name: nameSchema,
  /** One per time slot, in the order of the read's `timeSlots`. */
  slots: z.array(judgeSlotSchema),
  /** The events this judge is cleared for. */
  clearedFor: z.array(idSchema),
  judgedCount: countSchema,
  /** The entries this judge never judges by a strike. */
  strikes: z.array(
    z.strictObject({
      source: z.enum(judgeStrikeSources),
      entryName: nameSchema,
    }),
  ),
  /** A conflict declared to hold in every event, as tab recorded it. */
  declaredConflict: z
    .strictObject({ note: z.string().trim().min(1).max(500) })
    .nullable(),
});
export type ListedJudge = z.infer<typeof listedJudgeSchema>;

const judgeGroupSchema = z.strictObject({
  responsible: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('school'),
      organizationId: idSchema,
      name: nameSchema,
    }),
    z.strictObject({ kind: z.literal('guardian'), name: nameSchema }),
    z.strictObject({ kind: z.literal('unaffiliated') }),
  ]),
  judgesOwed: countSchema,
  judgesNamed: countSchema,
  judges: z.array(listedJudgeSchema),
});
export type JudgeGroup = z.infer<typeof judgeGroupSchema>;

/** A tournament's judges for its host, with availability by time slot. */
export const judgeListViewSchema = z
  .strictObject({
    lobbyId: idSchema,
    events: z.array(entryEventSchema).min(1),
    timeSlots: z.array(z.strictObject({ id: idSchema, name: nameSchema })),
    counts: z.strictObject({ debaters: countSchema, judges: countSchema }),
    /** The next tab round's need: judges named so far, or free in its slot. */
    need: z.strictObject({
      tabRoundName: nameSchema,
      eventName: nameSchema,
      judgesNeeded: countSchema,
      judgesCounted: countSchema,
      counting: z.enum(['named', 'free']),
    }),
    groups: z.array(judgeGroupSchema),
    /** Judges of one more school not yet shown. */
    notShown: z
      .strictObject({ schoolName: nameSchema, count: z.int().min(1) })
      .nullable(),
    capabilities: z.strictObject({ manageJudges: z.boolean() }),
  })
  .refine(
    (view) =>
      view.groups.every((group) =>
        group.judges.every(
          (judge) => judge.slots.length === view.timeSlots.length,
        ),
      ),
    { message: 'a judge has one slot per time slot', path: ['groups'] },
  );
export type JudgeListView = z.infer<typeof judgeListViewSchema>;

/** One student's entries at the tournament, and what stops their submission. */
const schoolStudentSchema = z.strictObject({
  id: idSchema,
  name: nameSchema,
  /** The roster note the school or guardian keeps, such as a season count. */
  note: z.string().trim().min(1).max(200).nullable(),
  entries: z.array(
    z.strictObject({
      id: idSchema,
      eventName: nameSchema,
      partnerNames: z.array(nameSchema),
    }),
  ),
  /** Two of the student's events run at the same time. */
  clash: z
    .strictObject({ eventNames: z.tuple([nameSchema, nameSchema]) })
    .nullable(),
});
export type SchoolStudent = z.infer<typeof schoolStudentSchema>;

/** A school's or a family's own entries at one tournament. */
export const schoolEntriesViewSchema = z.strictObject({
  lobbyId: idSchema,
  tournamentName: nameSchema,
  responsible: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('school'),
      organizationId: idSchema,
      name: nameSchema,
    }),
    z.strictObject({ kind: z.literal('guardian'), name: nameSchema }),
  ]),
  /** The tournament's entry terms as its host published them. */
  terms: z.string().trim().min(1).max(500),
  students: z.array(schoolStudentSchema),
  judges: z.strictObject({
    owed: countSchema,
    named: countSchema,
    /** When the last judge may still be named. */
    dueAt: z.iso.datetime().nullable(),
    /** How the tournament counts the judges owed, as its host published it. */
    terms: z.string().trim().min(1).max(500),
  }),
  capabilities: z.strictObject({
    manageRoster: z.boolean(),
    submit: z.boolean(),
  }),
});
export type SchoolEntriesView = z.infer<typeof schoolEntriesViewSchema>;

export const entryReadCatalogue = {
  EntryListView: { gate: ['lobby.host.read'] },
  JudgeListView: { gate: ['lobby.host.read'] },
  SchoolEntriesView: {
    gate: ['school.roster.manage', 'school.ballots.read', 'guardian.link.read'],
  },
} as const satisfies LobbyReadCatalogue<
  'EntryListView' | 'JudgeListView' | 'SchoolEntriesView'
>;
