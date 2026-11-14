import { pairingForceKeys } from './force';
import type {
  PairingPresetName,
  SettingKey,
  SettingValues,
} from './setting-values';

/** Every `pairing.*` key but the preset itself, and every `bye.*` key. */
export type PresetKey = Exclude<
  Extract<SettingKey, `pairing.${string}` | `bye.${string}`>,
  'pairing.preset'
>;
type PresetValues = { readonly [Key in PresetKey]: SettingValues[Key] };

const seededElimination = { structure: 'seeded' } as const;
const weighedInCatalogueOrder = { order: pairingForceKeys };

/**
 * A pairing preset is a named bundle of pairing and bye values a host picks
 * for an event. It supplies the fallback for each of its keys, so a host
 * never writes a force and an organization's own row still wins.
 */
export const pairingPresets: Record<PairingPresetName, PresetValues> = {
  /** Power-matched: a random first round, then high against low within a record. */
  swiss_power: {
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
    'pairing.preference_order': weighedInCatalogueOrder,
    'bye.recipient': { value: 'lowest' },
    'bye.result': { value: 'win' },
    'bye.repeat': { force: 'rule' },
  },
  /** Every preliminary round drawn at random, set before the first. */
  random: {
    'pairing.method': {
      preliminary: {
        structure: 'prematched',
        first: 'random',
        later: 'random',
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
      force: 'warning',
      choose: 'least_pulled',
      maxRecordDistance: null,
    },
    'pairing.position_balance': { force: 'preference' },
    'pairing.section_repeat': { force: 'preference' },
    'pairing.preference_order': weighedInCatalogueOrder,
    'bye.recipient': { value: 'random' },
    'bye.result': { value: 'win' },
    'bye.repeat': { force: 'rule' },
  },
  /** Everyone meets everyone, so meeting again or a schoolmate is not weighed. */
  round_robin: {
    'pairing.method': {
      preliminary: {
        structure: 'round_robin',
        first: 'seeded',
        later: 'top_down',
        lag: 0,
      },
      elimination: seededElimination,
    },
    'pairing.section_size': { target: 6 },
    'pairing.rematch': { force: 'off' },
    'pairing.same_school': { force: 'off' },
    'pairing.side_balance': { force: 'preference', maxImbalance: 1 },
    'pairing.side_alternation': { force: 'preference' },
    'pairing.pull_up': {
      force: 'warning',
      choose: 'least_pulled',
      maxRecordDistance: null,
    },
    'pairing.position_balance': { force: 'preference' },
    'pairing.section_repeat': { force: 'off' },
    'pairing.preference_order': weighedInCatalogueOrder,
    'bye.recipient': { value: 'lowest' },
    'bye.result': { value: 'own_average' },
    'bye.repeat': { force: 'rule' },
  },
};
