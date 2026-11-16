import { createInvariantError } from '@daisy/errors';
import {
  ballotDefinitionIdentity,
  scoreLatticeValues,
  scoreLatticeSize,
  scoreValueAt,
  type BallotDefinition,
  type Side,
} from '@daisy/protocol';

type BallotPoints = NonNullable<BallotDefinition['points']>;

/**
 * The AI judge's instructions, generated from the ballot definition a Round
 * froze and the Round's sides (TAB-6.13): the scale and criteria it scores,
 * the decision it makes, its written limits and a JSON example of the exact
 * ballot. For `speaker-10@2` over the two-sided preset the text is the one
 * Daisy has always sent (the judge corpus holds it byte for byte).
 */

/** A side named in prose: its label, read mid-sentence. */
const prose = (side: Side) => side.label.toLowerCase();
const quoted = (text: string) => `"${text}"`;

/** `2 and 4`, `1, 2 and 4`. */
const listed = (items: readonly string[]) =>
  items.length < 2
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

const everySide = (sides: readonly Side[]) =>
  sides.length === 2 ? 'both sides' : 'every side';

/** `1 to 5`, or `1 to 5 in steps of 0.5` off a whole-number step of one. */
const rangeText = (scale: BallotPoints['scale']) =>
  `${scale.min} to ${scale.max}${scale.step === 1 ? '' : ` in steps of ${scale.step}`}`;

/** Where each of a criterion's anchors sits on the scale, spread evenly and on a step. */
const anchorPoints = (scale: BallotPoints['scale'], count: number) => {
  const size = scoreLatticeSize(scale);
  if (size === null)
    throw createInvariantError(
      'ai-judge-score-scale',
      'The score lattice has no safe indexed representation',
    );
  return Array.from({ length: count }, (_, index) => {
    const offset =
      count === 1
        ? size - 1
        : Number(
            (2n * BigInt(index) * BigInt(size - 1) + BigInt(count - 1)) /
              (2n * BigInt(count - 1)),
          );
    const value = scoreValueAt(scale, offset);
    if (value === null)
      throw createInvariantError(
        'ai-judge-score-scale',
        'The score anchor is not representable',
      );
    return value;
  });
};

/** The scores between the anchors, said once: `(2 and 4 sit between them)`. */
const betweenText = (points: BallotPoints): string => {
  if (points.criteria.kind !== 'grid') return '';
  const counts = new Set(
    points.criteria.groups.flatMap((group) =>
      group.categories.map((category) => category.anchors.length),
    ),
  );
  const [count] = counts;
  if (counts.size !== 1 || count === undefined) return '';
  const anchored = new Set(anchorPoints(points.scale, count));
  const values = scoreLatticeValues(points.scale);
  if (!values) return ' (the scores between two anchors sit between them)';
  const between = values.filter((value) => !anchored.has(value));
  if (between.length === 0) return '';
  return between.length <= 3
    ? ` (${listed(between.map(String))} sit between them)`
    : ' (the scores between two anchors sit between them)';
};

/** The scale and criteria a definition scores, as every judging prompt states them. */
export const scoringAnchors = (
  points: BallotPoints,
  sides: readonly Side[],
): string => {
  if (points.criteria.kind === 'holistic')
    return `Score ${everySide(sides)} once each, ${rangeText(points.scale)}, for the whole performance.`;
  return [
    `Score every category for ${everySide(sides)}, ${rangeText(points.scale)}, against these anchors${betweenText(points)}:`,
    ...points.criteria.groups.flatMap((group) => [
      `${group.name}:`,
      ...group.categories.map((category) => {
        const at = anchorPoints(points.scale, category.anchors.length);
        return `- ${category.name}: ${category.anchors
          .map((anchor, index) => `${at[index]} = ${anchor}`)
          .join('; ')}`;
      }),
    ]),
  ].join('\n');
};

/** The judge's role and task: who it is, what it decides, and on what scale. */
export const judgeRubric = (
  definition: BallotDefinition,
  sides: readonly Side[],
): string =>
  [
    'You are an experienced, fair debate judge who judges like a thoughtful lay person.',
    definition.decision.kind === 'winner'
      ? 'Decide who did the better job of persuading you the resolution is true or false, based only on what was said.'
      : 'Rank the sides by how well each persuaded you the resolution is true or false, based only on what was said.',
    'Do not reward invented evidence. Ignore transcription glitches. Do not intervene with your own arguments.',
    ...(definition.points ? [scoringAnchors(definition.points, sides)] : []),
  ].join('\n');

/** The decision field of the example ballot. */
const decisionExample = (
  decision: BallotDefinition['decision'],
  keys: readonly string[],
): string => {
  const sides = keys.map(quoted).join(' | ');
  if (decision.kind === 'ranking')
    return `"ranking": [${keys.map((key) => `[${quoted(key)}]`).join(', ')}]`;
  if (!decision.tie && !decision.doubleLoss) return `"winner": ${sides}`;
  const outcomes = [
    'win',
    ...(decision.tie ? ['tie'] : []),
    ...(decision.doubleLoss ? ['double_loss'] : []),
  ];
  return `"decision": ${outcomes.map(quoted).join(' | ')}, "winner": ${sides} | null`;
};

const scoresExample = (points: BallotPoints, keys: readonly string[]) => {
  const value =
    points.criteria.kind === 'grid'
      ? `{${points.criteria.groups
          .flatMap((group) => group.categories)
          .map((category) => `${quoted(category.id)}: ${points.scale.min}`)
          .join(', ')}}`
      : `${points.scale.min}`;
  return `"scores": {${keys.map((key) => `${quoted(key)}: ${value}`).join(', ')}}`;
};

/** The exact ballot, as a one-line JSON example of its shape. */
const ballotExample = (
  definition: BallotDefinition,
  sides: readonly Side[],
): string => {
  const keys = sides.map((side) => side.key);
  return `{${[
    `"rubricVersion": ${quoted(ballotDefinitionIdentity(definition))}`,
    decisionExample(definition.decision, keys),
    ...(definition.points ? [scoresExample(definition.points, keys)] : []),
    ...(definition.written.reason
      ? ['"reason": "two or three sentences explaining the decision"']
      : []),
    ...(definition.written.feedback
      ? [
          `"feedback": {${sides
            .map(
              (side) =>
                `${quoted(side.key)}: "two sentences for the ${prose(side)}"`,
            )
            .join(', ')}}`,
        ]
      : []),
  ].join(', ')}}`;
};

/** Which key is which side, said only when a key does not spell its label. */
const sidesLegend = (sides: readonly Side[]): readonly string[] =>
  sides.every((side) => side.key === prose(side))
    ? []
    : [
        `The sides, by key: ${listed(
          sides.map((side) => `${quoted(side.key)} is ${side.label}`),
        )}.`,
      ];

const decisionRules = (
  decision: BallotDefinition['decision'],
): readonly string[] => {
  if (decision.kind === 'ranking')
    return [
      decision.ties
        ? 'The ranking lists every side exactly once, best first; sides that tie share a place.'
        : 'The ranking lists every side exactly once, best first, one side to a place.',
    ];
  return [
    ...(decision.tie || decision.doubleLoss
      ? [
          'Name the winner exactly when the decision is "win"; otherwise the winner is null.',
        ]
      : []),
    ...(decision.lowPointWin
      ? []
      : ["The winner's total is never lower than another side's."]),
  ];
};

const scoreRule = (points: BallotPoints | null): readonly string[] => {
  if (!points) return [];
  return points.criteria.kind === 'grid'
    ? [
        `Every category score is ${rangeText(points.scale)} against the anchors.`,
      ]
    : [`Every score is ${rangeText(points.scale)}.`];
};

/** What the judge returns: the exact ballot, its rules and its limits. */
export const ballotInstructions = (
  definition: BallotDefinition,
  sides: readonly Side[],
): string => {
  const { reason, feedback } = definition.written;
  return [
    'Return only a JSON object of this shape:',
    ballotExample(definition, sides),
    ...sidesLegend(sides),
    [
      ...scoreRule(definition.points),
      ...decisionRules(definition.decision),
      ...(feedback
        ? [
            `${sides.length === 2 ? 'Both sides get' : 'Every side gets'} feedback on what to do differently next time.`,
          ]
        : ['Feedback is off: do not include a feedback field.']),
    ].join(' '),
    reason && feedback
      ? `The reason is at most ${reason.max} characters. Each side's feedback is at most ${feedback.max} characters. An answer over either limit is rejected.`
      : [
          reason
            ? `The reason is at most ${reason.max} characters.`
            : 'Reason is off: do not include a reason field.',
          feedback
            ? `Each side's feedback is at most ${feedback.max} characters.`
            : 'Feedback is off: do not include a feedback field.',
          'An answer over an enabled limit is rejected.',
        ].join(' '),
  ].join('\n\n');
};
