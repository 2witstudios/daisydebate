import { createInvariantError } from '@daisy/errors';
import {
  ballotSchemaFor,
  aiBallotAdmissionRefusal,
  ballotSubjectsFor,
  isDebatingSeat,
  seatOrder,
  type RoundRules,
  type SeatRef,
  twoSideKeys,
  type Ballot,
  type BallotDefinition,
  type BallotSubjects,
  type JudgingStageInput,
  type Side,
} from '@daisy/protocol';
import type { z } from 'zod';
import { ballotAnswer, type JudgedAnswer, type ModelAnswer } from './judge';
import { ballotWireSchemaFor, type JsonSchema } from './judge-contract';
import type { ChatMessage } from './openrouter';
import { judgingStageMessages } from './staged-judge';
import { subjectJudgeMessages } from './subject-judge';
import type { TranscriptEvidenceInput } from './transcript-evidence';

/** What the AI judge reads of a Round's rules: its sides and its segments. */
export type AiJudgeRules = {
  readonly sides: readonly Side[];
  readonly segments: readonly {
    readonly key: string;
    readonly speak?: RoundRules['segments'][number]['speak'];
  }[];
  readonly seats?: RoundRules['seats'];
};

/**
 * The AI judge for one Round (TAB-6.13): the ballot definition the Round
 * froze, over the Round's sides. Its prompts, its wire schema and its
 * acceptance of an answer all derive from that one definition.
 */
export type AiJudge = {
  readonly definition: BallotDefinition;
  /** The ballot contract every answer is held to. */
  readonly ballotSchema: z.ZodType<Ballot>;
  /** The provider request's output schema, derived from the contract. */
  readonly ballotWireSchema: JsonSchema;
  /**
   * Whether the coherency stages (ADR 0125) apply: the case map is a
   * two-sided contract, so only a Round on the two-sided preset is mapped
   * and finally judged; any other is judged by the first stage alone.
   */
  readonly coherency: boolean;
  readonly stageMessages: (
    evidence: TranscriptEvidenceInput,
    stage: JudgingStageInput,
  ) => ChatMessage[];
  readonly judgeAnswer: (answer: ModelAnswer) => JudgedAnswer;
};

/** Why no AI judge exists for a definition over a format. */
const refuse = (invariantId: string) =>
  createInvariantError(invariantId, 'The AI judge cannot judge this ballot');

const onTwoSidedPreset = (sides: readonly Side[]) =>
  sides.length === twoSideKeys.length &&
  sides.every((side, index) => side.key === twoSideKeys[index]);

/**
 * The AI judge for a frozen definition and a Round's rules. The AI judges
 * sided formats only. Speaker and speech subjects come from the complete
 * frozen cast and rules, never from which voices happened to be transcribed.
 */
export function aiJudgeFor(
  definition: BallotDefinition,
  rules: AiJudgeRules,
  participants: readonly { readonly id: string; readonly seat: SeatRef }[] = [],
): AiJudge {
  const { sides } = rules;
  const refusal = aiBallotAdmissionRefusal(definition, rules, participants);
  if (refusal) throw refuse(refusal);
  const namedSubjects =
    definition.speakerRanks ||
    (definition.decision.kind === 'ranking' &&
      definition.decision.of === 'speakers') ||
    (definition.points !== null && definition.points.per !== 'side');
  const speakers = participants
    .filter((p) => isDebatingSeat(p.seat))
    .sort((a, b) => seatOrder(sides)(a.seat, b.seat));
  const subjects: BallotSubjects = ballotSubjectsFor(
    rules,
    namedSubjects ? speakers : [],
  );
  // Every ballot the definition's schema accepts is a ballot record.
  const ballotSchema = ballotSchemaFor(
    definition,
    subjects,
  ) as unknown as z.ZodType<Ballot>;
  const coherency = onTwoSidedPreset(sides);
  return {
    definition,
    ballotSchema,
    ballotWireSchema: ballotWireSchemaFor(definition, subjects),
    coherency,
    stageMessages: (evidence, stage) => {
      if (stage.stage !== 'first' && !coherency)
        throw refuse('ai-judge-coherency-two-sided');
      return namedSubjects && stage.stage !== 'map'
        ? subjectJudgeMessages(
            evidence,
            stage,
            definition,
            rules,
            speakers,
            subjects,
          )
        : judgingStageMessages(evidence, stage, definition, sides);
    },
    judgeAnswer: (answer) => ballotAnswer(answer, ballotSchema),
  };
}
