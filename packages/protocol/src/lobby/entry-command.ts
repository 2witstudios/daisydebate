import { z } from 'zod';
import { idSchema } from '../primitives';
import { lobbyCommandEnvelope, type LobbyCommandCatalogue } from './command';

/**
 * The entry and judge commands of a tournament (TAB-5.11): entering people
 * in an event with their division and responsible adult, settling and
 * changing entries, and inviting, striking and scheduling judges. Entry
 * commands and an entry's strikes and conflicts change the event's entries
 * (aggregate `event`, version `entries`); the other judge commands change a
 * tournament judge of the lobby (aggregate `lobby`).
 */

const nameSchema = z.string().trim().min(1).max(120);
/** A division is a name from the event's `entry.divisions` setting. */
const divisionSchema = z.string().trim().min(1).max(60);
const reasonSchema = z.string().trim().min(1).max(500);

/** Who answers for the entry: a school's coach, a guardian, or the adult entered. */
const responsibleSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('school'), schoolOrganizationId: idSchema }),
  z.strictObject({ kind: z.literal('guardian'), guardianLinkId: idSchema }),
  z.strictObject({ kind: z.literal('self') }),
]);

const distinct = (ids: readonly string[]) => new Set(ids).size === ids.length;

export const entryCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('submit-entry'),
    eventId: idSchema,
    name: nameSchema,
    memberActorIds: z
      .array(idSchema)
      .min(1)
      .max(8)
      .refine(distinct, 'A person is in an entry once'),
    responsible: responsibleSchema,
    division: divisionSchema.nullable(),
  }),
  z.strictObject({ type: z.literal('accept-entry'), entryId: idSchema }),
  z.strictObject({ type: z.literal('decline-entry'), entryId: idSchema }),
  z.strictObject({
    type: z.literal('withdraw-entry'),
    entryId: idSchema,
    reason: reasonSchema,
  }),
  z
    .strictObject({
      type: z.literal('replace-entry-member'),
      entryId: idSchema,
      outActorId: idSchema,
      inActorId: idSchema,
    })
    .refine((command) => command.outActorId !== command.inActorId, {
      message: 'A replacement is another person',
      path: ['inActorId'],
    }),
  z.strictObject({
    type: z.literal('set-entry-division'),
    entryId: idSchema,
    division: divisionSchema.nullable(),
  }),
  z.strictObject({
    type: z.literal('choose-break'),
    entryId: idSchema,
    stageId: idSchema,
  }),
]);
export type EntryCommand = z.infer<typeof entryCommandSchema>;

export const entryRefusals = [
  'registration-closed',
  'already-entered',
  'age-band',
  'no-responsible-adult',
  'division-unknown',
  'division-ineligible',
  'entry-cap',
  'slot-clash',
  'entry-settled',
  'guardian-pending',
  'fixture-started',
  'stage-started',
  'not-double-qualified',
  'choice-closed',
] as const;
export type EntryRefusal = (typeof entryRefusals)[number];
export const entryRefusalSchema = z.enum(entryRefusals);

const onEntries = {
  aggregate: 'event',
  versions: ['entries'],
  history: 'entry',
} as const;

export const entryCommandCatalogue = {
  'submit-entry': {
    ...onEntries,
    gate: ['entry.submit'],
    refusals: [
      'registration-closed',
      'already-entered',
      'age-band',
      'no-responsible-adult',
      'division-unknown',
      'division-ineligible',
      'entry-cap',
      'slot-clash',
    ],
  },
  'accept-entry': {
    ...onEntries,
    gate: ['tournament.entries.manage'],
    refusals: ['entry-settled', 'slot-clash', 'guardian-pending'],
  },
  'decline-entry': {
    ...onEntries,
    gate: ['tournament.entries.manage'],
    refusals: ['entry-settled'],
  },
  'withdraw-entry': {
    ...onEntries,
    gate: ['entry.withdraw'],
    refusals: ['entry-settled'],
  },
  'replace-entry-member': {
    ...onEntries,
    versions: ['entries', 'timeSlot'],
    gate: ['entry.submit'],
    refusals: [
      'already-entered',
      'fixture-started',
      'slot-clash',
      'division-ineligible',
    ],
  },
  'set-entry-division': {
    ...onEntries,
    gate: ['tournament.entries.manage'],
    refusals: ['division-unknown', 'division-ineligible', 'stage-started'],
  },
  'choose-break': {
    ...onEntries,
    gate: ['entry.submit'],
    refusals: ['not-double-qualified', 'choice-closed'],
  },
} as const satisfies LobbyCommandCatalogue<EntryCommand>;

export const entryCommandEnvelopeSchema =
  lobbyCommandEnvelope(entryCommandSchema);

/** One judge's availability in one time slot of its lobby. */
const availabilitySchema = z.strictObject({
  timeSlotId: idSchema,
  available: z.boolean(),
});

export const judgeCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('invite-judge'),
    actorId: idSchema,
    /** The judge's school, an affiliation for conflict detection only. */
    schoolOrganizationId: idSchema.nullable(),
    chairQualified: z.boolean(),
    /** The events of the lobby they may judge; left out is every event. */
    eventIds: z
      .array(idSchema)
      .min(1)
      .refine(distinct, 'An event is named once')
      .optional(),
  }),
  z.strictObject({
    type: z.literal('remove-judge'),
    tournamentJudgeId: idSchema,
  }),
  z.strictObject({
    type: z.literal('accept-judge-invitation'),
    tournamentJudgeId: idSchema,
  }),
  z.strictObject({
    type: z.literal('decline-judge-invitation'),
    tournamentJudgeId: idSchema,
  }),
  z.strictObject({
    type: z.literal('strike-judge'),
    entryId: idSchema,
    tournamentJudgeId: idSchema,
  }),
  z.strictObject({
    type: z.literal('withdraw-strike'),
    entryId: idSchema,
    tournamentJudgeId: idSchema,
  }),
  z.strictObject({
    type: z.literal('set-judge-availability'),
    tournamentJudgeId: idSchema,
    availability: z
      .array(availabilitySchema)
      .min(1)
      .refine(
        (slots) => distinct(slots.map((slot) => slot.timeSlotId)),
        'A time slot is named once',
      ),
  }),
  z.strictObject({
    type: z.literal('declare-conflict'),
    tournamentJudgeId: idSchema,
    entryId: idSchema,
  }),
]);
export type JudgeCommand = z.infer<typeof judgeCommandSchema>;

export const judgeRefusals = [
  'already-invited',
  'judge-assigned',
  'invitation-closed',
  'strike-exists',
  'strike-absent',
] as const;
export type JudgeRefusal = (typeof judgeRefusals)[number];
export const judgeRefusalSchema = z.enum(judgeRefusals);

const onJudge = { aggregate: 'lobby', versions: [], history: 'entry' } as const;

export const judgeCommandCatalogue = {
  'invite-judge': {
    ...onJudge,
    gate: ['tournament.entries.manage'],
    refusals: ['already-invited'],
  },
  'remove-judge': {
    ...onJudge,
    gate: ['tournament.entries.manage'],
    refusals: ['judge-assigned'],
  },
  'accept-judge-invitation': {
    ...onJudge,
    gate: ['judge.invitation.respond'],
    refusals: ['invitation-closed'],
  },
  'decline-judge-invitation': {
    ...onJudge,
    gate: ['judge.invitation.respond'],
    refusals: ['invitation-closed'],
  },
  'strike-judge': {
    ...onEntries,
    gate: ['entry.submit'],
    refusals: ['strike-exists', 'judge-assigned'],
  },
  'withdraw-strike': {
    ...onEntries,
    gate: ['entry.submit'],
    refusals: ['strike-absent'],
  },
  'set-judge-availability': {
    ...onJudge,
    gate: ['judge.availability.update'],
    refusals: ['judge-assigned'],
  },
  'declare-conflict': {
    ...onEntries,
    gate: ['judge.availability.update', 'tournament.entries.manage'],
    refusals: ['strike-exists'],
  },
} as const satisfies LobbyCommandCatalogue<JudgeCommand>;

export const judgeCommandEnvelopeSchema =
  lobbyCommandEnvelope(judgeCommandSchema);
