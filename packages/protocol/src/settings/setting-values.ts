import { z } from 'zod';
import { conflictHandlingSchema } from '../authorization';
import { interruptionModeSchema, MAX_PRE_ROUND_PREP_MS } from '../format';
import { idSchema } from '../primitives';
import {
  MAX_DRAW_SIZE,
  MAX_STRIKE_WINDOW_MS,
  MIN_DRAW_SIZE,
  MIN_STRIKE_WINDOW_MS,
} from '../resolution-draw';
import {
  audienceMapSchema,
  participantAudienceMapSchema,
} from './audience-map';
import {
  forced,
  forceKeys,
  judgingForceKeys,
  orderOf,
  pairingForceKeys,
} from './force';

/** Every value is a JSON object: a single choice is `{ value }`. */
const choice = <const Options extends readonly [string, ...string[]]>(
  options: Options,
) => z.strictObject({ value: z.enum(options) });
const count = z.int().min(0);
const size = z.int().min(1);

export const pairingPresetNames = [
  'swiss_power',
  'random',
  'round_robin',
] as const;
export type PairingPresetName = (typeof pairingPresetNames)[number];

/** How a panel's ballots become one decision. */
export const panelDecisionRuleSchema = z.enum(['majority', 'rank_sum']);
const panel = z.strictObject({
  size: size.refine((value) => value % 2 === 1, 'A panel has an odd size.'),
  decision: panelDecisionRuleSchema,
});

/** The tab engine's version 1 standings metrics. */
export const standingsMetricSchema = z.enum([
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
]);

const breakLine = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('fixed'), size }),
  z.strictObject({ kind: z.literal('record'), wins: count }),
  z.strictObject({
    kind: z.literal('record_capped'),
    wins: count,
    cap: size,
    floor: size,
  }),
  z.strictObject({ kind: z.literal('tie_inclusive'), size, ceiling: size }),
]);
const divisionKey = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/);
const division = z.strictObject({
  key: divisionKey,
  label: z.string().trim().min(1).max(60),
  eligibility: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('open') }),
    z.strictObject({
      kind: z.literal('declared'),
      statement: z.string().trim().min(1).max(500),
    }),
    z.strictObject({ kind: z.literal('prior_entries_at_most'), count }),
  ]),
});
const instant = z.iso.datetime();
const release = z.enum(['with_posting', 'manual']);

/**
 * The value schema of every setting key. A value that differs between
 * preliminary and elimination tab rounds is one object keyed by stage kind,
 * because a stage is not a scope.
 */
export const settingValueSchemas = {
  'pairing.preset': choice(pairingPresetNames),
  'pairing.method': z.strictObject({
    preliminary: z.strictObject({
      structure: z.enum(['powered', 'prematched', 'round_robin']),
      first: z.enum(['seeded', 'random']),
      later: z.enum(['fold', 'slide', 'adjacent', 'random', 'top_down']),
      /** How many of the latest tab rounds the pairing standings leave out. */
      lag: count,
    }),
    elimination: z.strictObject({ structure: z.literal('seeded') }),
  }),
  'pairing.section_size': z.strictObject({ target: z.int().min(4).max(7) }),
  'pairing.rematch': forced('pairing.rematch'),
  'pairing.same_school': forced('pairing.same_school'),
  'pairing.side_balance': forced('pairing.side_balance').extend({
    maxImbalance: count,
  }),
  'pairing.side_alternation': forced('pairing.side_alternation'),
  'pairing.pull_up': forced('pairing.pull_up').extend({
    choose: z.enum(['least_pulled', 'lowest_strength']),
    maxRecordDistance: size.nullable(),
  }),
  'pairing.position_balance': forced('pairing.position_balance'),
  'pairing.section_repeat': forced('pairing.section_repeat'),
  'pairing.preference_order': orderOf(pairingForceKeys),
  'bye.recipient': choice(['lowest', 'random']),
  'bye.result': choice(['win', 'own_average']),
  'bye.repeat': forced('bye.repeat'),
  'judging.panel': z.strictObject({ preliminary: panel, elimination: panel }),
  'judging.availability': forced('judging.availability'),
  'judging.strike': forced('judging.strike'),
  'judging.conflict': forced('judging.conflict'),
  'judging.same_school': forced('judging.same_school'),
  'judging.repeat_judge': forced('judging.repeat_judge'),
  'judging.unsubmitted_ballot': forced('judging.unsubmitted_ballot'),
  'judging.load_balance': forced('judging.load_balance'),
  'judging.chair': forced('judging.chair'),
  'judging.panel_same_school': forced('judging.panel_same_school'),
  'judging.preference_order': orderOf(judgingForceKeys),
  'standings.tiebreaks': z.strictObject({
    metrics: z
      .array(standingsMetricSchema)
      .min(1)
      .refine(
        (metrics) => new Set(metrics).size === metrics.length,
        'A tiebreak is named once.',
      ),
    minimumGames: size.nullable(),
    terminal: z.enum(['lot', 'shared']),
  }),
  'standings.rating_ladder': z.strictObject({ ladderId: idSchema.nullable() }),
  'break.line': z.strictObject({
    default: breakLine,
    byDivision: z.record(divisionKey, breakLine),
  }),
  'break.seeding': choice(['standings', 'rating']),
  'break.double_qualifier': choice(['higher', 'both', 'choice']),
  'entry.divisions': z.strictObject({
    items: z
      .array(division)
      .refine(
        (items) => new Set(items.map((item) => item.key)).size === items.length,
        'A division key is used once.',
      ),
  }),
  'entry.registration': z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('closed') }),
    z.strictObject({ state: z.literal('open') }),
    z
      .strictObject({
        state: z.literal('window'),
        opensAt: instant,
        closesAt: instant,
      })
      .refine(
        (window) => Date.parse(window.opensAt) < Date.parse(window.closesAt),
        'A registration window closes after it opens.',
      ),
  ]),
  'entry.approval': choice(['automatic', 'host']),
  'entry.cap': z.strictObject({
    perEvent: size.nullable(),
    perSchool: size.nullable(),
  }),
  'conflict.handling': z.strictObject({ value: conflictHandlingSchema }),
  'recording.capture': choice(['on', 'off']),
  'audience.posting': audienceMapSchema,
  'audience.decision': audienceMapSchema,
  'audience.scores': participantAudienceMapSchema,
  'audience.reason': participantAudienceMapSchema,
  'audience.feedback': participantAudienceMapSchema,
  'audience.video': audienceMapSchema,
  'ballot.screening': choice(['hold', 'off']),
  'resolution.rule': z.discriminatedUnion('method', [
    z.strictObject({ method: z.literal('fixed'), release }),
    z.strictObject({ method: z.literal('draw'), release }),
    z.strictObject({
      method: z.literal('strike'),
      drawSize: z.int().min(MIN_DRAW_SIZE).max(MAX_DRAW_SIZE),
      strikeWindowMs: z
        .int()
        .min(MIN_STRIKE_WINDOW_MS)
        .max(MAX_STRIKE_WINDOW_MS),
      /** A side by its place in the format's list. */
      firstStriker: z.union([z.literal(0), z.literal(1)]),
    }),
  ]),
  'resolution.own_text': choice(['allowed', 'off']),
  'room.own_format': choice(['allowed', 'off']),
  'room.visibility': choice(['public', 'unlisted']),
  'room.timing': z.strictObject({
    preRoundPrepMs: count.max(MAX_PRE_ROUND_PREP_MS),
    inRoundPrepMsPerSide: count,
    countdownMs: count,
  }),
  'room.floor': z.strictObject({
    interruptions: z.strictObject({
      mode: interruptionModeSchema,
      minRemainingMs: count,
    }),
    yielding: z.strictObject({
      allowed: z.boolean(),
      returnsTime: z.boolean(),
    }),
  }),
  'staff.minimum_band': choice(['adult', '16-17']),
} satisfies Record<keyof typeof forceKeys, z.ZodType> &
  Record<string, z.ZodType>;

export type SettingKey = keyof typeof settingValueSchemas;
export type SettingValues = {
  [Key in SettingKey]: z.infer<(typeof settingValueSchemas)[Key]>;
};
export const settingKeySchema = z.enum(
  Object.keys(settingValueSchemas) as [SettingKey, ...SettingKey[]],
);
