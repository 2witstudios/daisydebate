import {
  ballotCategories,
  ballotRubric,
  ballotRubricVersion,
} from '@daisy/protocol';

/**
 * The default judging instructions: the speaker rubric the ballot contract
 * scores against (DEC-116), rendered from the protocol's own table.
 */
export const DEFAULT_RUBRIC = [
  'You are an experienced, fair debate judge who judges like a thoughtful lay person.',
  'Decide who did the better job of persuading you the resolution is true or false, based only on what was said.',
  'Do not reward invented evidence. Ignore transcription glitches. Do not intervene with your own arguments.',
  'Score every category for both sides, 1 to 5, against these anchors:',
  ...ballotRubric.flatMap((group) => [
    `${group.name}:`,
    ...group.categories.map(
      (category) =>
        `- ${category.name}: 1 = ${category.anchors[0]}; 3 = ${category.anchors[1]}; 5 = ${category.anchors[2]}`,
    ),
  ]),
].join('\n');

export const ballotInstructions = [
  'Return only a JSON object of this shape:',
  `{"rubricVersion": "${ballotRubricVersion}", "winner": "affirmative" | "negative", "scores": {"affirmative": {${ballotCategories.map((category) => `"${category}": 1`).join(', ')}}, "negative": {${ballotCategories.map((category) => `"${category}": 1`).join(', ')}}}, "reason": "two or three sentences explaining the decision", "feedback": {"affirmative": "two sentences for the affirmative", "negative": "two sentences for the negative"}}`,
  'Every category score is 1 to 5 against the anchors. Both sides get feedback on what to do differently next time.',
].join('\n\n');
