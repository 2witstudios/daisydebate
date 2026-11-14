/**
 * The resolved settings the engine reads: one value per catalogue key, a
 * flat map, already resolved for the event by the caller. Nothing here can
 * say where a value came from (scope, hold or template): the engine never
 * knows. The catalogue in `@daisy/protocol` owns the keys; this is the
 * engine's own copy of the words, and the wiring proves the two agree.
 */

export const forces = ['rule', 'preference', 'warning', 'off'] as const;
/** How hard the engine tries: never broken, weighed, reported, or not applied. */
export type Force = (typeof forces)[number];

/** Every key whose value carries a force, with the only forces it accepts. */
export const forceKeys = {
  'pairing.rematch': ['rule', 'preference', 'warning', 'off'],
  'pairing.same_school': ['rule', 'preference', 'warning', 'off'],
  'pairing.side_balance': ['rule', 'preference', 'warning', 'off'],
  'pairing.side_alternation': ['rule', 'preference', 'off'],
  'pairing.pull_up': ['preference', 'warning'],
  'pairing.position_balance': ['preference', 'warning', 'off'],
  'pairing.section_repeat': ['preference', 'warning', 'off'],
  'bye.repeat': ['rule', 'preference', 'warning', 'off'],
  'judging.availability': ['rule', 'warning'],
  'judging.strike': ['rule', 'preference', 'warning', 'off'],
  'judging.conflict': ['rule', 'warning'],
  'judging.same_school': ['rule', 'preference', 'warning', 'off'],
  'judging.repeat_judge': ['rule', 'preference', 'warning', 'off'],
  'judging.unsubmitted_ballot': ['rule', 'warning', 'off'],
  'judging.load_balance': ['preference', 'warning', 'off'],
  'judging.chair': ['rule', 'preference', 'warning', 'off'],
  'judging.panel_same_school': ['preference', 'warning', 'off'],
} as const satisfies Record<string, readonly Force[]>;

export type ForceKey = keyof typeof forceKeys;
export type PairingForceKey = Extract<
  ForceKey,
  `pairing.${string}` | `bye.${string}`
>;
export type JudgingForceKey = Extract<ForceKey, `judging.${string}`>;

/** A force value limited, by type, to the forces its key allows. */
export type Forced<Key extends ForceKey> = {
  readonly force: (typeof forceKeys)[Key][number];
};

export type StageKind = 'preliminary' | 'elimination';

export type PreliminaryMethod = {
  readonly structure: 'powered' | 'prematched' | 'round_robin';
  readonly first: 'seeded' | 'random';
  readonly later: 'fold' | 'slide' | 'adjacent' | 'random' | 'top_down';
  /** How many of the latest tab rounds the pairing standings leave out. */
  readonly lag: number;
};

export type PanelRule = {
  readonly size: number;
  readonly decision: 'majority' | 'rank_sum';
};

/** The version 1 standings metrics, as the catalogue names them. */
export const metrics = [
  'wins',
  'win_percentage',
  'ballot_count',
  'total_points',
  'high_low_points',
  'opponent_wins',
  'opponent_points',
  'head_to_head',
  'cumulative_rank',
  'reciprocals',
  'team_points',
  'count_back',
  'rank_truncation',
  'worst_rank_drop',
  'rating',
] as const;
export type Metric = (typeof metrics)[number];

export type BreakLine =
  | { readonly kind: 'fixed'; readonly size: number }
  | { readonly kind: 'record'; readonly wins: number }
  | {
      readonly kind: 'record_capped';
      readonly wins: number;
      readonly cap: number;
      readonly floor: number;
    }
  | {
      readonly kind: 'tie_inclusive';
      readonly size: number;
      readonly ceiling: number;
    };

/** The keys the engine reads, with the catalogue's names and value shapes. */
export type ResolvedSettings = {
  readonly 'pairing.method': {
    readonly preliminary: PreliminaryMethod;
    readonly elimination: { readonly structure: 'seeded' };
  };
  readonly 'pairing.section_size': { readonly target: number };
  readonly 'pairing.rematch': Forced<'pairing.rematch'>;
  readonly 'pairing.same_school': Forced<'pairing.same_school'>;
  readonly 'pairing.side_balance': Forced<'pairing.side_balance'> & {
    readonly maxImbalance: number;
  };
  readonly 'pairing.side_alternation': Forced<'pairing.side_alternation'>;
  readonly 'pairing.pull_up': Forced<'pairing.pull_up'> & {
    readonly choose: 'least_pulled' | 'lowest_strength';
    readonly maxRecordDistance: number | null;
  };
  readonly 'pairing.position_balance': Forced<'pairing.position_balance'>;
  readonly 'pairing.section_repeat': Forced<'pairing.section_repeat'>;
  readonly 'pairing.preference_order': {
    readonly order: readonly PairingForceKey[];
  };
  readonly 'bye.recipient': { readonly value: 'lowest' | 'random' };
  readonly 'bye.result': { readonly value: 'win' | 'own_average' };
  readonly 'bye.repeat': Forced<'bye.repeat'>;
  readonly 'judging.panel': {
    readonly preliminary: PanelRule;
    readonly elimination: PanelRule;
  };
  readonly 'judging.availability': Forced<'judging.availability'>;
  readonly 'judging.strike': Forced<'judging.strike'>;
  readonly 'judging.conflict': Forced<'judging.conflict'>;
  readonly 'judging.same_school': Forced<'judging.same_school'>;
  readonly 'judging.repeat_judge': Forced<'judging.repeat_judge'>;
  readonly 'judging.unsubmitted_ballot': Forced<'judging.unsubmitted_ballot'>;
  readonly 'judging.load_balance': Forced<'judging.load_balance'>;
  readonly 'judging.chair': Forced<'judging.chair'>;
  readonly 'judging.panel_same_school': Forced<'judging.panel_same_school'>;
  readonly 'judging.preference_order': {
    readonly order: readonly JudgingForceKey[];
  };
  readonly 'standings.tiebreaks': {
    readonly metrics: readonly Metric[];
    readonly minimumGames: number | null;
    readonly terminal: 'lot' | 'shared';
  };
  readonly 'break.line': {
    readonly default: BreakLine;
    readonly byDivision: Readonly<Record<string, BreakLine>>;
  };
  readonly 'break.seeding': { readonly value: 'standings' | 'rating' };
  readonly 'break.double_qualifier': {
    readonly value: 'higher' | 'both' | 'choice';
  };
};

export type SettingKey = keyof ResolvedSettings;
