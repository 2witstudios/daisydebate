import { z } from 'zod';
import { idSchema } from '../primitives';
import { ballotCompetitionRecordSchema } from '../ballot-schema';
import { MAX_FORMAT_SEATS } from '../format-seating';
import { administrativeResultReasons } from './vocabulary';
import {
  administrativeAwardsSchema,
  resultCompetitionRecordSchema,
  type ResultCompetitionRecord,
} from './result-record';

/** A correction authors competitive values, never a new claim about who submitted them. */
export const resultCompetitionReplacementSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('decided'),
    contributions: z
      .array(
        z.strictObject({
          participantId: idSchema,
          contribution: ballotCompetitionRecordSchema,
        }),
      )
      .min(1)
      .max(MAX_FORMAT_SEATS),
  }),
  z.strictObject({
    kind: z.literal('administrative'),
    reason: z.enum(administrativeResultReasons),
    awards: administrativeAwardsSchema,
  }),
]);
export type ResultCompetitionReplacement = z.infer<
  typeof resultCompetitionReplacementSchema
>;
type Decided = Extract<ResultCompetitionRecord, { kind: 'decided' }>;
type Administrative = Extract<
  ResultCompetitionRecord,
  { kind: 'administrative' }
>;
export type CompetitionCorrectionAnswer =
  | { readonly kind: 'accepted'; readonly record: ResultCompetitionRecord }
  | {
      readonly kind: 'refused';
      readonly refusal:
        'outcome-mismatch' | 'submission-provenance-unavailable';
    };

/** Compare pinned JSON by value; dictionary key order is not provenance. */
const pinnedValue = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(pinnedValue)
    : value !== null && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([key, item]) => [key, pinnedValue(item)]),
        )
      : value;
const samePin = (left: unknown, right: unknown) =>
  JSON.stringify(pinnedValue(left)) === JSON.stringify(pinnedValue(right));

/** An administrative correction can restore only its own retained Round's original submissions. */
const sourceMatches = (record: Administrative, source: Decided): boolean =>
  record.sourceRoundId === source.source.roundId &&
  samePin(record.format, source.format) &&
  samePin(record.ballotSource, source.source.judging.source) &&
  samePin(record.definition, source.source.judging.ballot) &&
  samePin(record.pointUnit, source.pointUnit) &&
  record.fixture.kind === source.fixture.kind &&
  record.fixture.entries.length === source.fixture.entries.length &&
  record.fixture.entries.every((entry, index) => {
    const prior = source.fixture.entries[index];
    const members = source.cast
      .filter((person) => person.entryId === entry.entryId)
      .map((person) => person.actorId)
      .sort();
    return (
      entry.entryId === prior?.entryId &&
      entry.side === prior.side &&
      samePin([...entry.members].sort(), members)
    );
  });
const administrativeContext = (
  record: ResultCompetitionRecord,
): Omit<Administrative, 'reason' | 'awards'> => {
  if (record.kind === 'administrative') {
    return {
      version: record.version,
      kind: record.kind,
      format: record.format,
      ballotSource: record.ballotSource,
      definition: record.definition,
      pointUnit: record.pointUnit,
      sourceRoundId: record.sourceRoundId,
      fixture: record.fixture,
    };
  }
  return {
    version: 1,
    kind: 'administrative',
    format: record.format,
    ballotSource: record.source.judging.source,
    definition: record.source.judging.ballot,
    pointUnit: record.pointUnit,
    sourceRoundId: record.source.roundId,
    fixture: {
      kind: record.fixture.kind,
      entries: record.fixture.entries.map((entry) => ({
        ...entry,
        members: record.cast
          .filter((person) => person.entryId === entry.entryId)
          .map((person) => person.actorId),
      })),
    },
  };
};
const validated = (candidate: unknown): CompetitionCorrectionAnswer => {
  const parsed = resultCompetitionRecordSchema.safeParse(candidate);
  return parsed.success
    ? { kind: 'accepted', record: parsed.data }
    : { kind: 'refused', refusal: 'outcome-mismatch' };
};

/** Full replacement, with immutable provenance loaded from retained result history by the caller. */
export const replaceResultCompetitionRecord = (
  previous: ResultCompetitionRecord,
  replacement: unknown,
  originalSubmissions?: Decided,
): CompetitionCorrectionAnswer => {
  const parsed = resultCompetitionReplacementSchema.safeParse(replacement);
  if (!parsed.success) return { kind: 'refused', refusal: 'outcome-mismatch' };
  const next = parsed.data;
  if (next.kind === 'administrative')
    return validated({
      ...administrativeContext(previous),
      reason: next.reason,
      awards: next.awards,
    });
  const source = previous.kind === 'decided' ? previous : originalSubmissions;
  if (
    !source ||
    (previous.kind === 'administrative' && !sourceMatches(previous, source))
  )
    return { kind: 'refused', refusal: 'submission-provenance-unavailable' };
  const submitted = source.panel.filter(
    (judge) => judge.ballot.kind === 'submitted',
  );
  const ids = next.contributions.map((row) => row.participantId);
  if (
    ids.length !== submitted.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !submitted.some((judge) => judge.participantId === id))
  )
    return { kind: 'refused', refusal: 'outcome-mismatch' };
  const panel: Decided['panel'] = [];
  for (const judge of source.panel) {
    if (judge.ballot.kind === 'no_ruling') panel.push(judge);
    else {
      const contribution = next.contributions.find(
        (row) => row.participantId === judge.participantId,
      );
      if (!contribution)
        return { kind: 'refused', refusal: 'outcome-mismatch' };
      panel.push({
        ...judge,
        ballot: { ...judge.ballot, contribution: contribution.contribution },
      });
    }
  }
  return validated({ ...source, panel });
};
