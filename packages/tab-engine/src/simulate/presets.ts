import type { PairingForceKey, ResolvedSettings } from '../shapes/settings';

/**
 * The catalogue's three pairing presets, expanded into the settings the
 * engine reads, beside Daisy's defaults for every other key it reads. The
 * wording each restates is the preset's own description in the catalogue
 * (`@daisy/protocol`, pairing-presets). The wiring proves these values equal
 * the catalogue's; the engine itself has no defaults.
 */
const pairingOrder: readonly PairingForceKey[] = [
  'pairing.rematch',
  'pairing.same_school',
  'pairing.side_balance',
  'pairing.side_alternation',
  'pairing.pull_up',
  'pairing.position_balance',
  'pairing.section_repeat',
  'bye.repeat',
];

const daisyDefaults = {
  'judging.panel': {
    preliminary: { size: 1, decision: 'majority' },
    elimination: { size: 3, decision: 'majority' },
  },
  'judging.availability': { force: 'rule' },
  'judging.strike': { force: 'rule' },
  'judging.conflict': { force: 'rule' },
  'judging.same_school': { force: 'rule' },
  'judging.repeat_judge': { force: 'preference' },
  'judging.unsubmitted_ballot': { force: 'warning' },
  'judging.load_balance': { force: 'preference' },
  'judging.chair': { force: 'preference' },
  'judging.panel_same_school': { force: 'preference' },
  'judging.preference_order': {
    order: [
      'judging.repeat_judge',
      'judging.chair',
      'judging.panel_same_school',
      'judging.load_balance',
      'judging.availability',
      'judging.strike',
      'judging.conflict',
      'judging.same_school',
      'judging.unsubmitted_ballot',
    ],
  },
  'standings.tiebreaks': {
    metrics: ['wins', 'total_points', 'opponent_wins'],
    minimumGames: null,
    terminal: 'lot',
  },
  'break.line': { default: { kind: 'fixed', size: 8 }, byDivision: {} },
  'break.seeding': { value: 'standings' },
  'break.double_qualifier': { value: 'higher' },
} as const satisfies Partial<ResolvedSettings>;

const seededElimination = { structure: 'seeded' } as const;

/** Power-matched: a random first round, then high against low within a record. */
export const swissPower: ResolvedSettings = {
  ...daisyDefaults,
  'pairing.method': {
    preliminary: {
      structure: 'powered',
      first: 'random',
      later: 'fold',
      lag: 0,
    },
    elimination: seededElimination,
  },
  'pairing.section_size': { target: 6 },
  'pairing.rematch': { force: 'rule' },
  'pairing.same_school': { force: 'preference' },
  'pairing.side_balance': { force: 'preference', maxImbalance: 1 },
  'pairing.side_alternation': { force: 'preference' },
  'pairing.pull_up': {
    force: 'preference',
    choose: 'least_pulled',
    maxRecordDistance: 1,
  },
  'pairing.position_balance': { force: 'preference' },
  'pairing.section_repeat': { force: 'preference' },
  'pairing.preference_order': { order: pairingOrder },
  'bye.recipient': { value: 'lowest' },
  'bye.result': { value: 'win' },
  'bye.repeat': { force: 'rule' },
};

/** Every preliminary round drawn at random, set before the first. */
export const randomPreset: ResolvedSettings = {
  ...swissPower,
  'pairing.method': {
    preliminary: {
      structure: 'prematched',
      first: 'random',
      later: 'random',
      lag: 0,
    },
    elimination: seededElimination,
  },
  'pairing.pull_up': {
    force: 'warning',
    choose: 'least_pulled',
    maxRecordDistance: null,
  },
  'bye.recipient': { value: 'random' },
};

/** Everyone meets everyone, so meeting again or a schoolmate is not weighed. */
export const roundRobinPreset: ResolvedSettings = {
  ...swissPower,
  'pairing.method': {
    preliminary: {
      structure: 'round_robin',
      first: 'seeded',
      later: 'top_down',
      lag: 0,
    },
    elimination: seededElimination,
  },
  'pairing.rematch': { force: 'off' },
  'pairing.same_school': { force: 'off' },
  'pairing.pull_up': {
    force: 'warning',
    choose: 'least_pulled',
    maxRecordDistance: null,
  },
  'pairing.section_repeat': { force: 'off' },
  'bye.result': { value: 'own_average' },
};
