import type { TabAction } from './action';
import { sampleStandings } from './sample/standings';
import type { SampleScene } from './sample/scene';
import type { ResolvedSetting } from './settings';

export type StandingRow = {
  readonly seed: number;
  readonly entry: string;
  readonly school: string;
  readonly wins: number;
  readonly points: number;
  readonly opponentWins: number;
  readonly rating: number | null;
  /** The tiebreak that put the entry on this line. */
  readonly reason: string;
  /** Whether that tiebreak decided the break line. */
  readonly decisive: boolean;
};

/** An event's table, folded from its results each time it is read. */
export type StandingsTable = {
  readonly title: string;
  readonly lede: string;
  /** The tiebreak order as resolved, with where it comes from. */
  readonly tiebreaks: ResolvedSetting;
  readonly tiebreakOrder: readonly string[];
  readonly rows: readonly StandingRow[];
  /** The last seed that advances; null before a break is set. */
  readonly breakAfter: number | null;
  readonly remaining: number;
  /** Null for anyone who cannot announce the break, or once it is announced. */
  readonly announce: TabAction | null;
  readonly correction: TabAction | null;
};

export const readStandings = (
  slug: string,
  event: string | null,
  scene: SampleScene,
): StandingsTable | null => sampleStandings(slug, event, scene);
