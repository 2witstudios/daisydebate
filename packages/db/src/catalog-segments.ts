import {
  affirmativeSide,
  negativeSide,
  sideSeat,
  type SeatRef,
  type SegmentType,
} from '@daisy/protocol';

/**
 * The league templates' speech orders (FMT-2a), as each league's rules
 * publish them; catalog-formats.ts builds definitions from these rows.
 */

/** [key, label, type, seat, minutes]: the seat speaks a speech, or asks in cross-ex. */
export type SegmentRow = readonly [
  string,
  string,
  SegmentType,
  SeatRef,
  number,
];

/** The two-sided preset's seats, by slot. */
const aff = (slot: number) => sideSeat(affirmativeSide, slot);
const neg = (slot: number) => sideSeat(negativeSide, slot);

export const ldSegments: readonly SegmentRow[] = [
  ['AC', 'Affirmative constructive', 'speech', aff(0), 6],
  ['CX1', 'Cross-examination of the affirmative', 'cross_ex', neg(0), 3],
  ['NC', 'Negative constructive', 'speech', neg(0), 7],
  ['CX2', 'Cross-examination of the negative', 'cross_ex', aff(0), 3],
  ['1AR', 'First affirmative rebuttal', 'speech', aff(0), 4],
  ['NR', 'Negative rebuttal', 'speech', neg(0), 6],
  ['2AR', 'Second affirmative rebuttal', 'speech', aff(0), 3],
];

/** Constructive, cross-ex and rebuttal minutes of a two-person team round, in speaking order. */
type TeamTimes = {
  readonly constructives: readonly [number, number, number, number];
  readonly crossEx: number;
  readonly rebuttals: readonly [number, number, number, number];
};

/**
 * The two-person team order shared by team policy and Team IPDA: four
 * constructives, each followed by its cross-ex, then neg-first rebuttals.
 * The askers follow the NCFCA and IPDA rule (2N, 1A, 1N, 2A).
 */
const teamSegments = ({
  constructives: [c1, c2, c3, c4],
  crossEx,
  rebuttals: [r1, r2, r3, r4],
}: TeamTimes): readonly SegmentRow[] => [
  ['1AC', 'First affirmative constructive', 'speech', aff(0), c1],
  [
    'CX1',
    'Cross-examination of the first affirmative',
    'cross_ex',
    neg(1),
    crossEx,
  ],
  ['1NC', 'First negative constructive', 'speech', neg(0), c2],
  [
    'CX2',
    'Cross-examination of the first negative',
    'cross_ex',
    aff(0),
    crossEx,
  ],
  ['2AC', 'Second affirmative constructive', 'speech', aff(1), c3],
  [
    'CX3',
    'Cross-examination of the second affirmative',
    'cross_ex',
    neg(0),
    crossEx,
  ],
  ['2NC', 'Second negative constructive', 'speech', neg(1), c4],
  [
    'CX4',
    'Cross-examination of the second negative',
    'cross_ex',
    aff(1),
    crossEx,
  ],
  ['1NR', 'First negative rebuttal', 'speech', neg(0), r1],
  ['1AR', 'First affirmative rebuttal', 'speech', aff(0), r2],
  ['2NR', 'Second negative rebuttal', 'speech', neg(1), r3],
  ['2AR', 'Second affirmative rebuttal', 'speech', aff(1), r4],
];

/** Team policy: equal constructives and rebuttals, three-minute cross-ex. */
export const teamPolicySegments = (
  constructive: number,
  rebuttal: number,
): readonly SegmentRow[] =>
  teamSegments({
    constructives: [constructive, constructive, constructive, constructive],
    crossEx: 3,
    rebuttals: [rebuttal, rebuttal, rebuttal, rebuttal],
  });

/** IPDA Bylaws Art. 1 H, team debate format. */
export const teamIpdaSegments = teamSegments({
  constructives: [4, 5, 5, 4],
  crossEx: 2,
  rebuttals: [3, 4, 4, 3],
});

/** IPDA Bylaws Art. 1 H, individual debate format. */
export const ipdaSegments: readonly SegmentRow[] = [
  ['AC', 'Affirmative constructive', 'speech', aff(0), 5],
  ['CX1', 'Cross-examination of the affirmative', 'cross_ex', neg(0), 2],
  ['NC', 'Negative constructive', 'speech', neg(0), 6],
  ['CX2', 'Cross-examination of the negative', 'cross_ex', aff(0), 2],
  ['AR', 'Affirmative rebuttal', 'speech', aff(0), 3],
  ['NR', 'Negative rebuttal', 'speech', neg(0), 5],
  ['AS', 'Affirmative summary', 'speech', aff(0), 3],
];

/** Public Forum with the Pro team speaking first as Aff; crossfire is open questioning. */
export const publicForumSegments: readonly SegmentRow[] = [
  ['AC1', 'First affirmative constructive', 'speech', aff(0), 4],
  ['NC1', 'First negative constructive', 'speech', neg(0), 4],
  ['CF1', 'Crossfire', 'cross_ex', aff(0), 3],
  ['AR', 'Affirmative rebuttal', 'speech', aff(1), 4],
  ['NR', 'Negative rebuttal', 'speech', neg(1), 4],
  ['CF2', 'Crossfire', 'cross_ex', aff(1), 3],
  ['AS', 'Affirmative summary', 'speech', aff(0), 3],
  ['NS', 'Negative summary', 'speech', neg(0), 3],
  ['GCF', 'Grand crossfire', 'cross_ex', aff(0), 3],
  ['AFF', 'Affirmative final focus', 'speech', aff(1), 2],
  ['NFF', 'Negative final focus', 'speech', neg(1), 2],
];

export const bigQuestionsSegments: readonly SegmentRow[] = [
  ['AC', 'Affirmative constructive', 'speech', aff(0), 5],
  ['NC', 'Negative constructive', 'speech', neg(0), 5],
  ['Q1', 'Question segment', 'cross_ex', aff(0), 3],
  ['AR', 'Affirmative rebuttal', 'speech', aff(0), 4],
  ['NR', 'Negative rebuttal', 'speech', neg(0), 4],
  ['Q2', 'Question segment', 'cross_ex', neg(0), 3],
  ['ACS', 'Affirmative consolidation', 'speech', aff(0), 3],
  ['NCS', 'Negative consolidation', 'speech', neg(0), 3],
  ['ART', 'Affirmative rationale', 'speech', aff(0), 3],
  ['NRT', 'Negative rationale', 'speech', neg(0), 3],
];
