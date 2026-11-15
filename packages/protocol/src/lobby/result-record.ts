import { formatRevisionPinSchema } from '../format-reference';
import { roundCompetitionFreezeSchema } from '../round-competition-source';
import { z } from 'zod';
import { idSchema } from '../primitives';
import {
  ballotDefinitionSchema,
  panelRuleFor,
  ballotDefinitionSourceSchema,
  roundJudgingSchema,
} from '../ballot-definition';
import {
  ballotCompetitionRecordSchema,
  ballotCompetitionSchemaFor,
  ballotSubjectsFor,
} from '../ballot-schema';
import { roundRulesSchema } from '../format';
import { everySeatOf, MAX_FORMAT_SEATS } from '../format-seating';
import {
  isDebatingSeat,
  isJudgeSeat,
  seatKey,
  seatRefSchema,
  sideKeySchema,
  sideOfSeat,
} from '../seats';
import { scoreUnitFor, scoreUnitSchema, type ScoreUnit } from '../score-unit';
import { administrativeResultReasons } from './vocabulary';

const entry = z.strictObject({
  entryId: idSchema,
  side: sideKeySchema.nullable(),
});
const entries = z.array(entry).min(1).max(MAX_FORMAT_SEATS);
const castMember = z.strictObject({
  participantId: idSchema,
  actorId: idSchema,
  entryId: idSchema.nullable(),
  seat: seatRefSchema,
});
const submission = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('no_ruling') }),
  z.strictObject({
    kind: z.literal('submitted'),
    ballotId: idSchema,
    contentDigest: z.string().regex(/^[a-f0-9]{64}$/),
    submittedAt: z.iso.datetime(),
    /** The original submission identity/digest never changes when a correction replaces this contribution. */
    contribution: ballotCompetitionRecordSchema,
  }),
]);
const decided = z.strictObject({
  version: z.literal(1),
  kind: z.literal('decided'),
  format: formatRevisionPinSchema,
  fixture: z.strictObject({ kind: z.enum(['pairing', 'section']), entries }),
  source: roundCompetitionFreezeSchema,
  pointUnit: scoreUnitSchema.nullable(),
  cast: z.array(castMember).min(1).max(MAX_FORMAT_SEATS),
  /** Original fixture panel order: the chair first, with silent judges retained. */
  panel: z
    .array(
      z.strictObject({
        tournamentJudgeId: idSchema,
        participantId: idSchema,
        ballot: submission,
      }),
    )
    .min(1)
    .max(MAX_FORMAT_SEATS),
});
const speakerCredit = z.strictObject({
  actorId: idSchema,
  units: z.int().nonnegative(),
  rank: z.int().positive().nullable(),
});
const pointsCredit = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({ kind: z.literal('entry'), units: z.int().nonnegative() }),
  z.strictObject({
    kind: z.literal('speakers'),
    speakers: z.array(speakerCredit).min(1).max(MAX_FORMAT_SEATS),
  }),
]);
const credit = {
  entryId: idSchema,
  ballotCredits: z.int().min(0).max(MAX_FORMAT_SEATS),
  rankCredits: z.array(z.int().positive()).max(MAX_FORMAT_SEATS),
  points: pointsCredit,
};
export const administrativeAwardsSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('bye'),
      /** The policy is pinned; an own-average award is folded from actual played results. */
      rule: z.enum(['win', 'own_average']),
      panelSize: z.int().min(1).max(MAX_FORMAT_SEATS),
    }),
    z.strictObject({
      kind: z.literal('winner'),
      entries: z
        .array(z.strictObject({ ...credit, won: z.boolean() }))
        .min(1)
        .max(MAX_FORMAT_SEATS),
    }),
    z.strictObject({
      kind: z.literal('ranking'),
      entries: z
        .array(z.strictObject({ ...credit, rank: z.int().positive() }))
        .min(1)
        .max(MAX_FORMAT_SEATS),
    }),
  ])
  .superRefine((awards, ctx) => {
    if (awards.kind === 'bye') return;
    if (
      new Set(awards.entries.map((entry) => entry.entryId)).size !==
      awards.entries.length
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Every awarded entry appears exactly once',
        path: ['entries'],
      });
    for (const [index, entry] of awards.entries.entries())
      if (
        entry.points.kind === 'speakers' &&
        new Set(entry.points.speakers.map((person) => person.actorId)).size !==
          entry.points.speakers.length
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Every awarded speaker appears exactly once',
          path: ['entries', index, 'points', 'speakers'],
        });
  });
const administrative = z.strictObject({
  version: z.literal(1),
  kind: z.literal('administrative'),
  format: formatRevisionPinSchema,
  ballotSource: ballotDefinitionSourceSchema,
  definition: ballotDefinitionSchema,
  pointUnit: scoreUnitSchema.nullable(),
  sourceRoundId: idSchema.nullable(),
  fixture: z.strictObject({
    kind: z.enum(['pairing', 'section', 'bye']),
    entries: z
      .array(
        entry.extend({
          members: z.array(idSchema).min(1).max(MAX_FORMAT_SEATS),
        }),
      )
      .min(1)
      .max(MAX_FORMAT_SEATS),
  }),
  reason: z.enum(administrativeResultReasons),
  /** Credits are authored administrative awards, never submitted judge ballots. */
  awards: administrativeAwardsSchema,
});
const unique = (values: readonly string[]) =>
  new Set(values).size === values.length;
const sameUnit = (left: ScoreUnit | null, right: ScoreUnit | null) =>
  left === null || right === null
    ? left === right
    : left.numerator === right.numerator &&
      left.denominator === right.denominator;
const issue = (
  ctx: z.RefinementCtx,
  message: string,
  path: PropertyKey[] = [],
) => ctx.addIssue({ code: 'custom', message, path });

const validateDecided = (
  record: z.infer<typeof decided>,
  ctx: z.RefinementCtx,
) => {
  const { rules, judging } = record.source;
  // A field-level failure must not feed resource expansion or schema construction.
  if (
    !roundRulesSchema.safeParse(rules).success ||
    !roundJudgingSchema.unwrap().safeParse(judging).success
  )
    return;
  const declared = everySeatOf(rules).map(seatKey);
  const occupied = record.cast.map((person) => seatKey(person.seat));
  const entryIds = record.fixture.entries.map((row) => row.entryId);
  const castFits =
    unique(record.cast.map((row) => row.participantId)) &&
    unique(record.cast.map((row) => row.actorId)) &&
    unique(occupied) &&
    occupied.length === declared.length &&
    occupied.every((key) => declared.includes(key));
  const identitiesFit =
    unique(entryIds) &&
    record.cast.every((person) => {
      if (!isDebatingSeat(person.seat)) return person.entryId === null;
      const addressed = record.fixture.entries.find(
        (row) => row.entryId === person.entryId,
      );
      return (
        addressed !== undefined && addressed.side === sideOfSeat(person.seat)
      );
    }) &&
    entryIds.every((id) => record.cast.some((row) => row.entryId === id));
  const fixtureFits =
    record.fixture.kind === 'pairing'
      ? entryIds.length === rules.sides.length &&
        record.fixture.entries.every(
          (row, index) => row.side === rules.sides[index]?.key,
        )
      : rules.sides.length === 0 &&
        entryIds.length === rules.seats.speakers &&
        record.fixture.entries.every((row) => row.side === null);
  const judges = record.cast
    .filter((person) => isJudgeSeat(person.seat))
    .sort((a, b) => a.seat.slot - b.seat.slot);
  const panelFits =
    record.panel.length === judges.length &&
    unique(record.panel.map((row) => row.tournamentJudgeId)) &&
    unique(record.panel.map((row) => row.participantId)) &&
    record.panel.every(
      (row, index) => judges[index]?.participantId === row.participantId,
    );
  if (!castFits || !identitiesFit || !fixtureFits || !panelFits) {
    issue(
      ctx,
      'The record must preserve the complete actual cast, fixture and panel',
    );
    return;
  }
  if (
    rules.outcome.kind !== judging.ballot.decision.kind ||
    (rules.outcome.kind === 'ranking' &&
      judging.ballot.decision.kind === 'ranking' &&
      rules.outcome.of !== judging.ballot.decision.of)
  ) {
    issue(ctx, 'The frozen ballot must decide the format outcome', ['source']);
    return;
  }
  if (
    !sameUnit(
      record.pointUnit,
      judging.ballot.points ? scoreUnitFor(judging.ballot.points) : null,
    )
  )
    issue(ctx, 'The point unit belongs to the pinned ballot definition', [
      'pointUnit',
    ]);
  const submitted = record.panel.flatMap((judge) =>
    judge.ballot.kind === 'submitted' ? [judge.ballot] : [],
  );
  if (
    submitted.length < judging.panel.quorum ||
    !unique(submitted.map((ballot) => ballot.ballotId))
  )
    issue(
      ctx,
      'A decided record needs the frozen quorum and distinct actual submissions',
      ['panel'],
    );
  const subjects = ballotSubjectsFor(
    rules,
    record.cast.map((person) => ({
      id: person.participantId,
      seat: person.seat,
    })),
  );
  const about =
    judging.ballot.decision.kind === 'winner' ||
    judging.ballot.decision.of === 'sides'
      ? subjects.sides
      : subjects.speakers;
  const scored =
    judging.ballot.points?.per === 'side'
      ? subjects.sides
      : judging.ballot.points?.per === 'seat'
        ? subjects.speakers
        : subjects.segments;
  if (
    about.length === 0 ||
    (judging.ballot.points && scored.length === 0) ||
    (judging.ballot.speakerRanks && subjects.speakers.length === 0)
  ) {
    issue(ctx, 'A ballot requires its actual decision and score subjects', [
      'source',
    ]);
    return;
  }
  const schema = ballotCompetitionSchemaFor(judging.ballot, subjects);
  for (const [index, judge] of record.panel.entries())
    if (
      judge.ballot.kind === 'submitted' &&
      !schema.safeParse(judge.ballot.contribution).success
    )
      issue(
        ctx,
        'The contribution must satisfy its pinned ballot and actual subjects',
        ['panel', index, 'ballot', 'contribution'],
      );
};
const validateAdministrative = (
  record: z.infer<typeof administrative>,
  ctx: z.RefinementCtx,
) => {
  if (!ballotDefinitionSchema.safeParse(record.definition).success) return;
  if (
    !roundJudgingSchema.unwrap().safeParse({
      source: record.ballotSource,
      ballot: record.definition,
      panel: panelRuleFor(record.definition),
    }).success
  )
    issue(ctx, 'The source preserves its exact canonical definition', [
      'ballotSource',
    ]);
  const entries = record.fixture.entries;
  const ids = entries.map((row) => row.entryId);
  if (!unique(ids) || !unique(entries.flatMap((row) => row.members)))
    issue(ctx, 'The fixture preserves distinct entries and actual members');
  const bye = record.fixture.kind === 'bye';
  if (
    (record.reason === 'bye') !== bye ||
    (bye && (entries.length !== 1 || record.sourceRoundId !== null))
  )
    issue(ctx, 'A bye has one entry and no Round', ['fixture']);
  if (bye !== (record.awards.kind === 'bye'))
    issue(
      ctx,
      'A bye pins its own award policy, separately from played administrative credits',
      ['awards'],
    );
  if (
    !sameUnit(
      record.pointUnit,
      record.definition.points ? scoreUnitFor(record.definition.points) : null,
    )
  )
    issue(ctx, 'The point unit belongs to the pinned ballot definition', [
      'pointUnit',
    ]);
  if (record.awards.kind === 'bye') return;
  const awardIds = record.awards.entries.map((row) => row.entryId);
  if (
    !unique(awardIds) ||
    ids.length !== awardIds.length ||
    awardIds.some((id) => !ids.includes(id))
  )
    issue(ctx, 'Each actual entry receives exactly one administrative award');
  if (record.awards.kind !== record.definition.decision.kind)
    issue(ctx, 'An administrative award uses the event outcome kind', [
      'awards',
    ]);
  for (const [index, award] of record.awards.entries.entries()) {
    if (award.points.kind !== 'none' && record.definition.points === null)
      issue(ctx, 'A definition without points cannot receive point credits', [
        'awards',
        'entries',
        index,
      ]);
    if (award.points.kind === 'speakers') {
      const members =
        entries.find((entry) => entry.entryId === award.entryId)?.members ?? [];
      if (
        !unique(award.points.speakers.map((row) => row.actorId)) ||
        award.points.speakers.some((row) => !members.includes(row.actorId))
      )
        issue(ctx, 'Speaker credits name actual members only', [
          'awards',
          'entries',
          index,
        ]);
    }
  }
  if (record.awards.kind === 'winner') {
    const winners = record.awards.entries.filter((row) => row.won).length;
    if (
      (record.reason === 'double_loss' && winners !== 0) ||
      (record.reason !== 'double_loss' &&
        record.reason !== 'ruling' &&
        winners !== 1) ||
      winners > 1
    )
      issue(
        ctx,
        'Winner credits state one winner or an explicit administrative double loss',
        ['awards'],
      );
  } else {
    const ranks = [
      ...new Set(record.awards.entries.map((row) => row.rank)),
    ].sort((a, b) => a - b);
    if (ranks.some((rank, index) => rank !== index + 1))
      issue(ctx, 'Administrative ranks use complete ordered places', [
        'awards',
      ]);
  }
};

/** The sole authored competitive outcome; relational rows are projections of this record. */
export const resultCompetitionRecordSchema = z
  .discriminatedUnion('kind', [decided, administrative])
  .superRefine((record, ctx) => {
    if (record.kind === 'decided') validateDecided(record, ctx);
    else validateAdministrative(record, ctx);
  });
export type ResultCompetitionRecord = z.infer<
  typeof resultCompetitionRecordSchema
>;
