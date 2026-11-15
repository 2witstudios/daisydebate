import { z } from 'zod';
import { idSchema } from '../primitives';
import { administrativeAwardsSchema } from './result-record';
import { resultCompetitionReplacementSchema } from './result-record-correction';
import { lobbyCommandEnvelope, type LobbyCommandCatalogue } from './command';
import {
  administrativeResultReasons,
  audiences,
  releaseThings,
} from './vocabulary';

/**
 * Ballot and result commands (TAB-5.12). A result is append-only: each
 * command that makes one writes exactly one result row, and a correction is
 * a new result naming the one it supersedes. No command edits a result, and
 * none changes a published draw or recomputes anything.
 */

/** A reason a person typed: blank is allowed here and refused by the rule that needs one. */
const typedReason = z.string().max(2000);

/** One entry's outcome in a result, as the `result_entries` row holds it. */
export const resultEntryOutcomeSchema = z.strictObject({
  entryId: idSchema,
  won: z.boolean().nullable(),
  rank: z.int().positive().nullable(),
  ballotsWon: z.int().nonnegative().nullable(),
});
export type ResultEntryOutcome = z.infer<typeof resultEntryOutcomeSchema>;

/** Forfeit is recorded by officiating (`record-forfeit`), not here. */
const enteredAdministrativeReasons = administrativeResultReasons.filter(
  (reason): reason is Exclude<typeof reason, 'forfeit'> => reason !== 'forfeit',
);

const recordAdministrativeResultCommandSchema = z.strictObject({
  type: z.literal('record-administrative-result'),
  fixtureId: idSchema,
  administrativeReason: z.enum(enteredAdministrativeReasons),
  reason: typedReason,
  awards: administrativeAwardsSchema,
});
const recordDecidedResultCommandSchema = z.strictObject({
  type: z.literal('record-decided-result'),
  fixtureId: idSchema,
});

const correctResultCommandSchema = z.strictObject({
  type: z.literal('correct-result'),
  fixtureId: idSchema,
  supersedesResultId: idSchema,
  reason: typedReason,
  replacement: resultCompetitionReplacementSchema,
});

const certifyResultCommandSchema = z.strictObject({
  type: z.literal('certify-result'),
  resultId: idSchema,
});

const certifyEventCommandSchema = z.strictObject({
  type: z.literal('certify-event'),
  eventId: idSchema,
});

/**
 * Settles a screening hold: release the ballot's own text, or a redacted
 * text in its place. The ballot itself is never rewritten.
 */
const resolveScreeningHoldCommandSchema = z.strictObject({
  type: z.literal('resolve-screening-hold'),
  ballotId: idSchema,
  release: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('original') }),
    z.strictObject({
      kind: z.literal('redacted'),
      text: z.record(z.string().min(1), z.string().max(20_000)),
    }),
  ]),
});

export const resultCommandSchema = z.discriminatedUnion('type', [
  recordDecidedResultCommandSchema,
  recordAdministrativeResultCommandSchema,
  correctResultCommandSchema,
  certifyResultCommandSchema,
  certifyEventCommandSchema,
  resolveScreeningHoldCommandSchema,
]);
export type ResultCommand = z.infer<typeof resultCommandSchema>;
export const resultCommandEnvelopeSchema =
  lobbyCommandEnvelope(resultCommandSchema);

export const resultCommandRefusals = [
  'fixture-withdrawn',
  'fixture-unpublished',
  'result-exists',
  'outcome-mismatch',
  'submission-provenance-unavailable',
  'reason-required',
  'result-not-in-fixture',
  'already-superseded',
  'already-certified',
  'results-incomplete',
  'screening-pending',
  'hold-settled',
] as const;
export type ResultCommandRefusal = (typeof resultCommandRefusals)[number];

export const resultCommandCatalogue = {
  'record-decided-result': {
    aggregate: 'result',
    gate: ['tournament.results.enter'],
    versions: ['fixture'],
    refusals: [
      'fixture-withdrawn',
      'fixture-unpublished',
      'result-exists',
      'submission-provenance-unavailable',
      'outcome-mismatch',
    ],
    history: 'entry',
  },
  'record-administrative-result': {
    aggregate: 'result',
    gate: ['tournament.results.enter'],
    versions: ['fixture'],
    refusals: [
      'fixture-withdrawn',
      'fixture-unpublished',
      'result-exists',
      'outcome-mismatch',
      'reason-required',
    ],
    history: 'entry',
  },
  'correct-result': {
    aggregate: 'result',
    gate: ['tournament.results.enter'],
    versions: ['fixture'],
    refusals: [
      'fixture-withdrawn',
      'result-not-in-fixture',
      'already-superseded',
      'outcome-mismatch',
      'submission-provenance-unavailable',
      'reason-required',
    ],
    history: 'entry',
  },
  'certify-result': {
    aggregate: 'result',
    gate: ['tournament.results.release'],
    versions: ['results'],
    refusals: ['already-superseded', 'already-certified', 'screening-pending'],
    history: 'entry',
  },
  'certify-event': {
    aggregate: 'event',
    gate: ['tournament.results.release'],
    versions: ['results'],
    refusals: ['results-incomplete', 'already-certified', 'screening-pending'],
    history: 'entry',
  },
  'resolve-screening-hold': {
    aggregate: 'ballot',
    gate: ['tournament.results.release'],
    versions: [],
    refusals: ['hold-settled', 'screening-pending'],
    history: 'entry',
  },
} as const satisfies LobbyCommandCatalogue<ResultCommand>;

/**
 * Release commands (aggregate `release`), kept beside results because a
 * release is how a result's parts open. A release is append-only: once open
 * for an audience a thing stays open.
 */
const openAudienceCommandSchema = z.strictObject({
  type: z.literal('open-audience'),
  eventId: idSchema,
  /** One tab round, or every tab round of the event. */
  tabRounds: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('one'), tabRoundId: idSchema }),
    z.strictObject({ kind: z.literal('all') }),
  ]),
  thing: z.enum(releaseThings),
  audience: z.enum(audiences),
});

const releaseResolutionCommandSchema = z.strictObject({
  type: z.literal('release-resolution'),
  tabRoundId: idSchema,
});

export const releaseCommandSchema = z.discriminatedUnion('type', [
  openAudienceCommandSchema,
  releaseResolutionCommandSchema,
]);
export type ReleaseCommand = z.infer<typeof releaseCommandSchema>;

export const releaseCommandRefusals = [
  'not-manual',
  'audience-order',
  'screening-pending',
  'already-open',
  'already-released',
  'resolution-unset',
] as const;
export type ReleaseCommandRefusal = (typeof releaseCommandRefusals)[number];

export const releaseCommandCatalogue = {
  'open-audience': {
    aggregate: 'release',
    gate: ['tournament.results.release'],
    versions: [],
    refusals: [
      'not-manual',
      'audience-order',
      'screening-pending',
      'already-open',
    ],
    history: 'entry',
  },
  'release-resolution': {
    aggregate: 'release',
    gate: ['lobby.setup.manage'],
    versions: [],
    refusals: ['not-manual', 'already-released', 'resolution-unset'],
    history: 'entry',
  },
} as const satisfies LobbyCommandCatalogue<ReleaseCommand>;
