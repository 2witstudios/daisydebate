import type { StandingsView } from '@daisy/protocol/lobby/standings-read';
import type { standingsMetricSchema } from '@daisy/protocol/setting-values';
import type { z } from 'zod';
import { sampleAction, type TabAction } from './action';
import { sampleStandingsView } from './sample/standings';
import type { SampleScene } from './sample/scene';
import type { ResolvedSetting } from './settings';

export type StandingRow = {
  readonly seed: number;
  readonly entry: string;
  readonly school: string;
  readonly wins: number;
  /** Null for a viewer to whom no scores have been released. */
  readonly points: number | null;
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

type StandingsMetric = z.infer<typeof standingsMetricSchema>;

/** How the table names each tiebreak metric. */
const metricNames: Readonly<Record<StandingsMetric, string>> = {
  wins: 'wins',
  win_percentage: 'win percentage',
  ballot_count: 'ballots',
  total_points: 'speaker points',
  high_low_points: 'high-low speaker points',
  opponent_wins: "opponents' wins",
  opponent_points: "opponents' speaker points",
  head_to_head: 'head to head',
  cumulative_rank: 'cumulative rank',
  reciprocals: 'reciprocals',
  team_points: 'team points',
  count_back: 'count back',
  rank_truncation: 'truncated ranks',
  worst_rank_drop: 'worst rank dropped',
  rating: 'rating at the start',
};

/** An event's table: a projection of `StandingsView`, beside its tiebreak setting. */
export const standingsTableOf = (
  read: StandingsView,
  tiebreaks: ResolvedSetting,
): StandingsTable => {
  const official = read.visibility === 'official' ? read.capabilities : null;
  const rows: StandingRow[] = read.rows.map((row) => ({
    seed: row.seed,
    entry: row.entry.name,
    school: row.responsible.name,
    wins: row.wins,
    points: 'points' in row ? row.points : null,
    opponentWins: row.opponentWins,
    rating: row.rating,
    reason: row.explanation,
    decisive: row.decidesBreak,
  }));
  const { breakLine, progress } = read;
  return {
    title: `Standings after round ${read.throughRound}`,
    lede: [
      ...(breakLine === null
        ? []
        : [`Top ${breakLine.seeds} break to ${breakLine.tabRoundName.toLowerCase()}.`]),
      progress.kind === 'complete'
        ? `All ${progress.ballots} ballots are in.`
        : `Round ${progress.tabRoundNumber} is still running.`,
    ].join(' '),
    tiebreaks,
    tiebreakOrder: read.tiebreaks.map((metric) => metricNames[metric]),
    rows,
    breakAfter: breakLine?.seeds ?? null,
    remaining: read.entryCount - rows.length,
    announce:
      official?.announceBreak === true &&
      progress.kind === 'complete' &&
      read.breakAnnouncedAt === null
        ? sampleAction('Announce the break', true)
        : null,
    correction:
      official?.previewCorrection === true
        ? sampleAction('See what a correction would change')
        : null,
  };
};

export const readStandings = (
  slug: string,
  event: string | null,
  scene: SampleScene,
): StandingsTable | null => {
  const sample = sampleStandingsView(slug, event, scene);
  return sample === null
    ? null
    : standingsTableOf(sample.read, sample.tiebreaks);
};
