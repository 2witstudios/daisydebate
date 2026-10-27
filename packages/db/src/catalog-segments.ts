import type { DebateSide, SegmentType } from '@daisy/protocol';

/**
 * The league templates' speech orders (FMT-2a), as each league's rules
 * publish them; catalog-formats.ts builds definitions from these rows.
 */

/** [key, label, type, side, slot, minutes] */
export type SegmentRow = readonly [
  string,
  string,
  SegmentType,
  DebateSide,
  number,
  number,
];

export const ldSegments: readonly SegmentRow[] = [
  ['AC', 'Affirmative constructive', 'speech', 'affirmative', 0, 6],
  ['CX1', 'Cross-examination of the affirmative', 'cross_ex', 'negative', 0, 3],
  ['NC', 'Negative constructive', 'speech', 'negative', 0, 7],
  ['CX2', 'Cross-examination of the negative', 'cross_ex', 'affirmative', 0, 3],
  ['1AR', 'First affirmative rebuttal', 'speech', 'affirmative', 0, 4],
  ['NR', 'Negative rebuttal', 'speech', 'negative', 0, 6],
  ['2AR', 'Second affirmative rebuttal', 'speech', 'affirmative', 0, 3],
];

/** Team policy's order; the asker of each cross-ex follows the NCFCA rule (2N, 1A, 1N, 2A). */
export const teamPolicySegments = (
  constructive: number,
  rebuttal: number,
): readonly SegmentRow[] => [
  [
    '1AC',
    'First affirmative constructive',
    'speech',
    'affirmative',
    0,
    constructive,
  ],
  [
    'CX1',
    'Cross-examination of the first affirmative',
    'cross_ex',
    'negative',
    1,
    3,
  ],
  ['1NC', 'First negative constructive', 'speech', 'negative', 0, constructive],
  [
    'CX2',
    'Cross-examination of the first negative',
    'cross_ex',
    'affirmative',
    0,
    3,
  ],
  [
    '2AC',
    'Second affirmative constructive',
    'speech',
    'affirmative',
    1,
    constructive,
  ],
  [
    'CX3',
    'Cross-examination of the second affirmative',
    'cross_ex',
    'negative',
    0,
    3,
  ],
  [
    '2NC',
    'Second negative constructive',
    'speech',
    'negative',
    1,
    constructive,
  ],
  [
    'CX4',
    'Cross-examination of the second negative',
    'cross_ex',
    'affirmative',
    1,
    3,
  ],
  ['1NR', 'First negative rebuttal', 'speech', 'negative', 0, rebuttal],
  ['1AR', 'First affirmative rebuttal', 'speech', 'affirmative', 0, rebuttal],
  ['2NR', 'Second negative rebuttal', 'speech', 'negative', 1, rebuttal],
  ['2AR', 'Second affirmative rebuttal', 'speech', 'affirmative', 1, rebuttal],
];

/** Public Forum with the Pro team speaking first as Aff; crossfire is open questioning. */
export const publicForumSegments: readonly SegmentRow[] = [
  ['AC1', 'First affirmative constructive', 'speech', 'affirmative', 0, 4],
  ['NC1', 'First negative constructive', 'speech', 'negative', 0, 4],
  ['CF1', 'Crossfire', 'cross_ex', 'affirmative', 0, 3],
  ['AR', 'Affirmative rebuttal', 'speech', 'affirmative', 1, 4],
  ['NR', 'Negative rebuttal', 'speech', 'negative', 1, 4],
  ['CF2', 'Crossfire', 'cross_ex', 'affirmative', 1, 3],
  ['AS', 'Affirmative summary', 'speech', 'affirmative', 0, 3],
  ['NS', 'Negative summary', 'speech', 'negative', 0, 3],
  ['GCF', 'Grand crossfire', 'cross_ex', 'affirmative', 0, 3],
  ['AFF', 'Affirmative final focus', 'speech', 'affirmative', 1, 2],
  ['NFF', 'Negative final focus', 'speech', 'negative', 1, 2],
];

export const bigQuestionsSegments: readonly SegmentRow[] = [
  ['AC', 'Affirmative constructive', 'speech', 'affirmative', 0, 5],
  ['NC', 'Negative constructive', 'speech', 'negative', 0, 5],
  ['Q1', 'Question segment', 'cross_ex', 'affirmative', 0, 3],
  ['AR', 'Affirmative rebuttal', 'speech', 'affirmative', 0, 4],
  ['NR', 'Negative rebuttal', 'speech', 'negative', 0, 4],
  ['Q2', 'Question segment', 'cross_ex', 'negative', 0, 3],
  ['ACS', 'Affirmative consolidation', 'speech', 'affirmative', 0, 3],
  ['NCS', 'Negative consolidation', 'speech', 'negative', 0, 3],
  ['ART', 'Affirmative rationale', 'speech', 'affirmative', 0, 3],
  ['NRT', 'Negative rationale', 'speech', 'negative', 0, 3],
];
