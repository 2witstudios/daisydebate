import type { StructurePart, WeakSpot } from './summary';

export type Recommendation = {
  readonly part: StructurePart;
  readonly title: string;
  readonly reason: string;
  readonly minutes: number;
};

const drillTitles: Readonly<Record<StructurePart, string>> = {
  claim: 'Claim drill',
  warrant: 'Warrant drill',
  responding: 'Responding drill',
  impact: 'Impact drill',
};

const focus: Readonly<Record<StructurePart, string>> = {
  claim: 'stating what you ask the judge to believe',
  warrant: 'giving the reason it is true',
  responding: 'answering the point in front of you',
  impact: 'saying why it matters, and to whom',
};

const missedLabel: Readonly<Record<StructurePart, string>> = {
  claim: 'Your claim',
  warrant: 'Your warrant',
  responding: 'Your response',
  impact: 'Your impact',
};

/** The drill that targets the account's weakest part, or null with none. */
export const recommend = (spot: WeakSpot | null): Recommendation | null =>
  spot === null
    ? null
    : {
        part: spot.part,
        title: drillTitles[spot.part],
        reason: `${missedLabel[spot.part]} was missing or unclear in ${spot.missing} of your last ${spot.of} drills. Two short rounds on ${focus[spot.part]}.`,
        minutes: 8,
      };
