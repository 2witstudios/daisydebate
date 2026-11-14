import { z } from 'zod';
import { idSchema } from '../primitives';
import { judgingForceKeys } from '../settings/force';
import { lobbyCommandEnvelope, type LobbyCommandCatalogue } from './command';

/**
 * Fixture officiating (TAB-5.12): the commands that change a fixture's panel,
 * restart its Room or record its forfeit. None makes a draw version; on a
 * published fixture each answers one `officiated` fixture change.
 */

/** A reason a person typed: blank is allowed here and refused by the rule that needs one. */
const typedReason = z.string().max(2000);

/** A broken `judging.*` rule kept anyway, named with the reason. */
export const judgingOverrideSchema = z.strictObject({
  key: z.enum(judgingForceKeys),
  reason: typedReason,
});
export type JudgingOverride = z.infer<typeof judgingOverrideSchema>;

const overridesSchema = z
  .array(judgingOverrideSchema)
  .refine(
    (overrides) =>
      new Set(overrides.map((override) => override.key)).size ===
      overrides.length,
    'Each rule is overridden at most once.',
  );

export const assignJudgeCommandSchema = z.strictObject({
  type: z.literal('assign-judge'),
  fixtureId: idSchema,
  judgeId: idSchema,
  chair: z.boolean(),
  overrides: overridesSchema,
});

export const replaceJudgeCommandSchema = z
  .strictObject({
    type: z.literal('replace-judge'),
    fixtureId: idSchema,
    outJudgeId: idSchema,
    inJudgeId: idSchema,
    overrides: overridesSchema,
  })
  .refine((command) => command.outJudgeId !== command.inJudgeId, {
    message: 'A judge is not replaced by themselves.',
    path: ['inJudgeId'],
  });

export const unassignJudgeCommandSchema = z.strictObject({
  type: z.literal('unassign-judge'),
  fixtureId: idSchema,
  judgeId: idSchema,
});

export const restartFixtureCommandSchema = z.strictObject({
  type: z.literal('restart-fixture'),
  fixtureId: idSchema,
  reason: typedReason,
});

export const recordForfeitCommandSchema = z.strictObject({
  type: z.literal('record-forfeit'),
  fixtureId: idSchema,
  entryId: idSchema,
  reason: typedReason,
});

export const fixtureCommandSchema = z.discriminatedUnion('type', [
  assignJudgeCommandSchema,
  replaceJudgeCommandSchema,
  unassignJudgeCommandSchema,
  restartFixtureCommandSchema,
  recordForfeitCommandSchema,
]);
export type FixtureCommand = z.infer<typeof fixtureCommandSchema>;
export const fixtureCommandEnvelopeSchema =
  lobbyCommandEnvelope(fixtureCommandSchema);

/** Every refusal an officiating command can give, beside the shared ones. */
export const fixtureCommandRefusals = [
  'fixture-withdrawn',
  'fixture-unpublished',
  'fixture-bye',
  'result-exists',
  'panel-full',
  'judge-on-panel',
  'judge-not-on-panel',
  'judge-unavailable',
  'judge-double-booked',
  'rule-broken',
  'reason-required',
  'ballot-submitted',
  'round-not-started',
  'entry-not-in-fixture',
] as const;
export type FixtureCommandRefusal = (typeof fixtureCommandRefusals)[number];
export const fixtureCommandRefusalSchema = z.enum(fixtureCommandRefusals);

const assignRefusals = [
  'fixture-withdrawn',
  'fixture-bye',
  'result-exists',
  'panel-full',
  'judge-on-panel',
  'judge-unavailable',
  'judge-double-booked',
  'rule-broken',
  'reason-required',
] as const satisfies readonly FixtureCommandRefusal[];
const unassignRefusals = [
  'fixture-withdrawn',
  'fixture-bye',
  'result-exists',
  'judge-not-on-panel',
  'ballot-submitted',
] as const satisfies readonly FixtureCommandRefusal[];

/**
 * The judge commands also serve a fixture not yet published, under
 * `tournament.draw.edit`; on a published one they need
 * `tournament.rooms.officiate`.
 */
const judgeGate = [
  'tournament.rooms.officiate',
  'tournament.draw.edit',
] as const;

export const fixtureCommandCatalogue = {
  'assign-judge': {
    aggregate: 'fixture',
    gate: judgeGate,
    versions: ['fixture'],
    refusals: assignRefusals,
    history: 'entry',
  },
  'replace-judge': {
    aggregate: 'fixture',
    gate: judgeGate,
    versions: ['fixture'],
    refusals: [...new Set([...unassignRefusals, ...assignRefusals])],
    history: 'entry',
  },
  'unassign-judge': {
    aggregate: 'fixture',
    gate: judgeGate,
    versions: ['fixture'],
    refusals: unassignRefusals,
    history: 'entry',
  },
  'restart-fixture': {
    aggregate: 'fixture',
    gate: ['tournament.rooms.officiate'],
    versions: ['fixture'],
    refusals: [
      'fixture-withdrawn',
      'fixture-unpublished',
      'fixture-bye',
      'result-exists',
      'round-not-started',
      'reason-required',
    ],
    history: 'entry',
  },
  'record-forfeit': {
    aggregate: 'fixture',
    gate: ['tournament.rooms.officiate'],
    versions: ['fixture'],
    refusals: [
      'fixture-withdrawn',
      'fixture-unpublished',
      'fixture-bye',
      'result-exists',
      'entry-not-in-fixture',
      'reason-required',
    ],
    history: 'entry',
  },
} as const satisfies LobbyCommandCatalogue<FixtureCommand>;
