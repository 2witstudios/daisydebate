import {
  roundJudgeLineageSchema,
  terminalJudgeLineageMatches,
} from './round-judge-lineage';
import { z } from 'zod';
import { idSchema } from './primitives';
import { formatRevisionPinSchema } from './format-reference';
import { roundRulesSchema } from './format';
import { roundJudgingSchema, freezeBallotJudging } from './ballot-definition';
import {
  ballotCompetitionRecordSchema,
  ballotCompetitionSchemaFor,
  ballotSubjectsFor,
} from './ballot-schema';
import { everySeatOf, MAX_FORMAT_SEATS } from './format-seating';
import { isJudgeSeat, seatKey, seatRefSchema } from './seats';

/** The exact terminal receipt and frozen input identity; no consumer reloads mutable Round state. */
export const roundCompetitionFreezeSchema = z.strictObject({
  roundId: idSchema,
  freezeRevision: z.int().positive(),
  finalization: z.strictObject({
    commandId: idSchema,
    resultingVersion: z.int().positive(),
  }),
  judgeAssignments: roundJudgeLineageSchema,
  rules: roundRulesSchema,
  judging: roundJudgingSchema.unwrap(),
});
const castMember = z.strictObject({
  participantId: idSchema,
  actorId: idSchema,
  seat: seatRefSchema,
});
const contribution = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('no_ruling') }),
  z.strictObject({
    kind: z.literal('submitted'),
    ballotId: idSchema,
    contentDigest: z.string().regex(/^[a-f0-9]{64}$/),
    submittedAt: z.iso.datetime(),
    contribution: ballotCompetitionRecordSchema,
  }),
]);
const sourceShape = z.strictObject({
  version: z.literal(1),
  format: formatRevisionPinSchema,
  source: roundCompetitionFreezeSchema,
  cast: z.array(castMember).min(1).max(MAX_FORMAT_SEATS),
  panel: z
    .array(z.strictObject({ participantId: idSchema, ballot: contribution }))
    .min(1)
    .max(MAX_FORMAT_SEATS),
});
const unique = (values: readonly string[]) =>
  new Set(values).size === values.length;
/** Round publishes only immutable competitive output; private words and transcript data have no field here. */
export const roundCompetitionSourceSchema = sourceShape.superRefine(
  (value, ctx) => {
    const { rules, judging } = value.source;
    if (
      !roundRulesSchema.safeParse(rules).success ||
      !roundJudgingSchema.unwrap().safeParse(judging).success
    )
      return;
    const add = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (
      !terminalJudgeLineageMatches(
        value.source.judgeAssignments,
        rules.seats.judges,
        value.cast,
      )
    )
      add(
        'Terminal judge assignment history must preserve each frozen slot and its actual final occupant',
      );
    const occupied = value.cast.map((person) => seatKey(person.seat));
    const declared = everySeatOf(rules).map(seatKey);
    if (
      !unique(value.cast.map((person) => person.participantId)) ||
      !unique(value.cast.map((person) => person.actorId)) ||
      occupied.length !== declared.length ||
      occupied.some((key, index) => key !== declared[index])
    )
      add('The complete cast preserves the original execution seat order');
    const judges = value.cast.filter((person) => isJudgeSeat(person.seat));
    if (
      value.panel.length !== judges.length ||
      value.panel.some(
        (judge, index) => judge.participantId !== judges[index]?.participantId,
      )
    )
      add('The ordered panel names the actual judge slots');
    const frozen = freezeBallotJudging(rules, {
      source: judging.source,
      ballot: judging.ballot,
    });
    if (
      frozen.kind !== 'frozen' ||
      !frozen.judging ||
      JSON.stringify(frozen.judging.panel) !== JSON.stringify(judging.panel)
    )
      add('The frozen ballot and panel bind the original execution subjects');
    const subjects = ballotSubjectsFor(
      rules,
      value.cast.map((person) => ({
        id: person.participantId,
        seat: person.seat,
      })),
    );
    const submitted = value.panel.flatMap((judge) =>
      judge.ballot.kind === 'submitted' ? [judge.ballot] : [],
    );
    if (!unique(submitted.map((ballot) => ballot.ballotId)))
      add('A submission belongs to one actual judge');
    for (const ballot of submitted)
      if (
        !ballotCompetitionSchemaFor(judging.ballot, subjects).safeParse(
          ballot.contribution,
        ).success
      )
        add(
          'A contribution uses its exact immutable ballot definition and actual subjects',
        );
  },
);
export type RoundCompetitionSource = z.infer<
  typeof roundCompetitionSourceSchema
>;
