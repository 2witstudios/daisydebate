import type { Choice, TabAction } from './action';
import { sampleDrawBoard } from './sample/draw';
import type { SampleScene } from './sample/scene';
import type { EventSwitch } from './setup';

/** What the engine reports about a fixture; a broken rule is never relaxed. */
export type FixtureFlag = {
  readonly severity: 'note' | 'preference_bent' | 'rule_broken';
  readonly text: string;
};

export type DraftFixture = {
  readonly id: string;
  readonly title: string;
  readonly judges: string;
  readonly flags: readonly FixtureFlag[];
  readonly href: string;
  readonly selected: boolean;
};

/** The entries on the same record in this tab round's pairing. */
export type RecordGroup = {
  readonly record: string;
  readonly fixtures: readonly DraftFixture[];
};

/** What a different pairing of this fixture would cost. */
export type FixtureAlternative = {
  readonly heading: string;
  readonly cost: string;
  /** A rule the alternative breaks, which publishing must name and override. */
  readonly breaksRule: string | null;
  readonly show: TabAction;
};

export type FixtureDetail = {
  readonly title: string;
  readonly why: readonly string[];
  readonly seats: readonly Choice[];
  readonly alternative: FixtureAlternative | null;
};

/** A draft version of the plan for one tab round. */
export type DrawBoard = {
  readonly event: EventSwitch;
  readonly title: string;
  readonly version: number;
  readonly basis: string;
  readonly rulesBroken: number;
  readonly preferencesBent: number;
  readonly again: TabAction;
  readonly publish: TabAction;
  readonly groups: readonly RecordGroup[];
  readonly rest: string | null;
  readonly back: TabAction | null;
  readonly selected: FixtureDetail | null;
};

export const readDrawBoard = (
  slug: string,
  event: string,
  round: string,
  fixture: string | null,
  scene: SampleScene,
): DrawBoard | null => sampleDrawBoard(slug, event, round, fixture, scene);
