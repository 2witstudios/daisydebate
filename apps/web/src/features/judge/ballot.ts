import {
  ballotDefinitionIdentity,
  ballotSchemaFor,
  isLowPointWin,
  pointsTotal,
  type Ballot,
  type BallotDefinition,
} from '@daisy/protocol';
import { accept, field, refuse, type Parsed } from '../forms/form-state';
import { subjectChoices, type BallotPlan } from './ballot-plan';

/** What a definition scores, when it scores anything. */
export type BallotPoints = NonNullable<BallotDefinition['points']>;

/** The posted field for one subject's score in one criterion. */
export const scoreField = (subject: string, category: string): string =>
  `${subject}-${category}`;
/** The posted field for one subject's single, holistic score. */
export const pointsField = (subject: string): string => `points-${subject}`;
export const feedbackField = (subject: string): string => `feedback-${subject}`;
/** The posted field naming the subject in one place of a ranking, first place 1. */
export const placeField = (place: number): string => `place-${place}`;

/** The criteria a definition scores, in order; empty for a holistic score. */
export const criteriaOf = (points: BallotPoints) =>
  points.criteria.kind === 'grid'
    ? points.criteria.groups.flatMap((group) => group.categories)
    : [];

/** Every field a subject's points post as. */
const pointFields = (points: BallotPoints, subject: string): string[] =>
  points.criteria.kind === 'grid'
    ? criteriaOf(points).map((category) => scoreField(subject, category.id))
    : [pointsField(subject)];

/** Every field a plan's ballot posts, envelope aside. */
export const ballotFieldNames = (plan: BallotPlan): readonly string[] => {
  const { decision, points } = plan.definition;
  const decisionFields =
    decision.kind === 'winner'
      ? [
          'winner',
          ...(decision.tie || decision.doubleLoss ? ['decision'] : []),
          ...(points ? ['low-point'] : []),
        ]
      : plan.decided.map((_, index) => placeField(index + 1));
  return [
    ...decisionFields,
    'reason',
    ...plan.decided.map((subject) => feedbackField(subject.key)),
    ...(points
      ? plan.scored.flatMap((subject) => pointFields(points, subject.key))
      : []),
  ];
};

/** A rubric ballot read from form fields. */
export type PostedBallot = {
  readonly ballot: Ballot;
};

/** A posted score on the definition's scale, written canonically, or nothing. */
export const readScore = (
  scale: BallotPoints['scale'],
  value: string | undefined,
): number | null => {
  if (value === undefined || value === '') return null;
  const score = Number(value);
  return String(score) === value &&
    score >= scale.min &&
    score <= scale.max &&
    Number.isInteger((score - scale.min) / scale.step)
    ? score
    : null;
};

/** One subject's points as the form holds them: a criteria grid or one score. */
export const postedPoints = (
  points: BallotPoints,
  subject: string,
  read: (name: string) => string | undefined,
): Readonly<Record<string, number | null>> | number | null =>
  points.criteria.kind === 'grid'
    ? Object.fromEntries(
        criteriaOf(points).map((category) => [
          category.id,
          readScore(points.scale, read(scoreField(subject, category.id))),
        ]),
      )
    : readScore(points.scale, read(pointsField(subject)));

/**
 * What a low-point confirmation is given for: the winner and every scored
 * side's total, in declared order. The confirmation posts this as its value,
 * so one given for one result never confirms another.
 */
export const lowPointKey = (
  winner: string,
  scores: Readonly<Record<string, unknown>>,
  sides: readonly string[],
): string =>
  [winner, ...sides.map((side) => pointsTotal(scores[side] ?? 0))].join(':');

/**
 * A text field as the judge counted it: the browser posts each line break as
 * two characters (CRLF) where the textarea's own limit counted one.
 */
const text = (form: FormData, name: string): string =>
  field(form, name).replace(/\r\n/g, '\n');

type Decision =
  | { readonly ok: true; readonly fields: Record<string, unknown> }
  | { readonly ok: false; readonly error: string };

/** The decision's fields: a winner (or a tie or double loss where allowed), or a ranking. */
function readDecision(form: FormData, plan: BallotPlan): Decision {
  const { decision } = plan.definition;
  const keys = plan.decided.map((subject) => subject.key);
  switch (decision.kind) {
    case 'winner': {
      const winner = field(form, 'winner');
      const spelled = decision.tie || decision.doubleLoss;
      const outcome = spelled ? field(form, 'decision') || 'win' : 'win';
      if (outcome !== 'win')
        return { ok: true, fields: { decision: outcome, winner: null } };
      if (!keys.includes(winner))
        return {
          ok: false,
          error: `Pick who won: ${subjectChoices(plan.decided)}.`,
        };
      return {
        ok: true,
        fields: spelled ? { decision: 'win', winner } : { winner },
      };
    }
    case 'ranking': {
      const places = keys.map((_, index) => field(form, placeField(index + 1)));
      if (
        places.some((key) => !keys.includes(key)) ||
        new Set(places).size !== keys.length
      )
        return {
          ok: false,
          error: `Place each of ${subjectChoices(plan.decided)} once.`,
        };
      return { ok: true, fields: { ranking: places.map((key) => [key]) } };
    }
  }
}

/** Why a ballot's points did not parse, in the definition's own terms. */
const scoreRefusal = (points: BallotPoints): string =>
  points.criteria.kind === 'grid'
    ? `Score every category from ${points.scale.min} to ${points.scale.max}.`
    : `Give every score from ${points.scale.min} to ${points.scale.max}.`;

/**
 * A ballot, read from the posted form against the Round's own definition.
 * One ballot per judge seat. The judge makes the decision the definition
 * asks for, scores every subject it scores, writes what it requires, and
 * confirms a win on fewer points.
 */
export function parseBallot(
  form: FormData,
  plan: BallotPlan,
): Parsed<PostedBallot> {
  const { definition } = plan;
  const { points } = definition;
  const decision = readDecision(form, plan);
  if (!decision.ok) return refuse(decision.error);
  const words = readWritten(form, plan);
  if (!words.ok) return refuse(words.error);
  const parsed = ballotSchemaFor(definition, plan.subjects).safeParse({
    rubricVersion: ballotDefinitionIdentity(definition),
    ...decision.fields,
    ...(points ? { scores: readScores(form, plan, points) } : {}),
    ...(words.reason === '' ? {} : { reason: words.reason }),
    feedback: words.feedback,
  });
  if (!parsed.success)
    return refuse(
      points ? scoreRefusal(points) : 'Complete every part of the ballot.',
    );
  const ballot = parsed.data as Ballot;
  return lowPointUnconfirmed(form, plan, ballot)
    ? refuse('Confirm the low-point win, or change the scores.')
    : accept({ ballot });
}

/** Every scored subject's points as posted. */
const readScores = (form: FormData, plan: BallotPlan, points: BallotPoints) =>
  Object.fromEntries(
    plan.scored.map((subject) => [
      subject.key,
      postedPoints(points, subject.key, (name) => form.get(name)?.toString()),
    ]),
  );

type Written =
  | {
      readonly ok: true;
      readonly reason: string;
      readonly feedback: Record<string, string>;
    }
  | { readonly ok: false; readonly error: string };

/** The reason and each decided subject's feedback, within the definition's limits. */
function readWritten(form: FormData, plan: BallotPlan): Written {
  const { written } = plan.definition;
  const reason = text(form, 'reason');
  if (reason === '' && written.reason.required)
    return { ok: false, error: 'Write the reason for your decision.' };
  if (reason.length > written.reason.max)
    return {
      ok: false,
      error: `A reason is up to ${written.reason.max} characters. Shorten it.`,
    };
  const feedback = Object.fromEntries(
    plan.decided
      .map(
        (subject) =>
          [subject.key, text(form, feedbackField(subject.key))] as const,
      )
      .filter(([, text]) => text !== ''),
  );
  return Object.values(feedback).some(
    (text) => text.length > written.feedback.max,
  )
    ? {
        ok: false,
        error: `Feedback is up to ${written.feedback.max} characters. Shorten it.`,
      }
    : { ok: true, reason, feedback };
}

/** A win on fewer side points that the posted confirmation is not for. */
function lowPointUnconfirmed(
  form: FormData,
  plan: BallotPlan,
  ballot: Ballot,
): boolean {
  const winner = ballot.winner ?? null;
  return (
    winner !== null &&
    plan.definition.points?.per === 'side' &&
    ballot.scores !== undefined &&
    isLowPointWin(winner, ballot.scores) &&
    field(form, 'low-point') !==
      lowPointKey(winner, ballot.scores, plan.subjects.sides)
  );
}
