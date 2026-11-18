import type { ResolvedSettings } from '@daisy/tab-engine';
import {
  resolveSetting,
  type SettingChain,
  type FormatSettingDefaults,
} from '@daisy/protocol/setting-resolution';
import type { SettingRow } from '@daisy/protocol/settings';

/** The engine reads the same resolved catalogue values as the event's other consumers. */
export const engineSettings = (
  chain: SettingChain,
  rows: readonly SettingRow[],
  format: FormatSettingDefaults,
): ResolvedSettings => ({
  'pairing.method': resolveSetting('pairing.method', chain, rows, format).value,
  'pairing.section_size': resolveSetting(
    'pairing.section_size',
    chain,
    rows,
    format,
  ).value,
  'pairing.rematch': resolveSetting('pairing.rematch', chain, rows, format)
    .value,
  'pairing.same_school': resolveSetting(
    'pairing.same_school',
    chain,
    rows,
    format,
  ).value,
  'pairing.side_balance': resolveSetting(
    'pairing.side_balance',
    chain,
    rows,
    format,
  ).value,
  'pairing.side_alternation': resolveSetting(
    'pairing.side_alternation',
    chain,
    rows,
    format,
  ).value,
  'pairing.pull_up': resolveSetting('pairing.pull_up', chain, rows, format)
    .value,
  'pairing.position_balance': resolveSetting(
    'pairing.position_balance',
    chain,
    rows,
    format,
  ).value,
  'pairing.section_repeat': resolveSetting(
    'pairing.section_repeat',
    chain,
    rows,
    format,
  ).value,
  'pairing.preference_order': resolveSetting(
    'pairing.preference_order',
    chain,
    rows,
    format,
  ).value,
  'bye.recipient': resolveSetting('bye.recipient', chain, rows, format).value,
  'bye.result': resolveSetting('bye.result', chain, rows, format).value,
  'bye.repeat': resolveSetting('bye.repeat', chain, rows, format).value,
  'judging.panel': resolveSetting('judging.panel', chain, rows, format).value,
  'judging.availability': resolveSetting(
    'judging.availability',
    chain,
    rows,
    format,
  ).value,
  'judging.strike': resolveSetting('judging.strike', chain, rows, format).value,
  'judging.conflict': resolveSetting('judging.conflict', chain, rows, format)
    .value,
  'judging.same_school': resolveSetting(
    'judging.same_school',
    chain,
    rows,
    format,
  ).value,
  'judging.repeat_judge': resolveSetting(
    'judging.repeat_judge',
    chain,
    rows,
    format,
  ).value,
  'judging.unsubmitted_ballot': resolveSetting(
    'judging.unsubmitted_ballot',
    chain,
    rows,
    format,
  ).value,
  'judging.load_balance': resolveSetting(
    'judging.load_balance',
    chain,
    rows,
    format,
  ).value,
  'judging.chair': resolveSetting('judging.chair', chain, rows, format).value,
  'judging.panel_same_school': resolveSetting(
    'judging.panel_same_school',
    chain,
    rows,
    format,
  ).value,
  'judging.preference_order': resolveSetting(
    'judging.preference_order',
    chain,
    rows,
    format,
  ).value,
  'standings.tiebreaks': resolveSetting(
    'standings.tiebreaks',
    chain,
    rows,
    format,
  ).value,
  'break.line': resolveSetting('break.line', chain, rows, format).value,
  'break.seeding': resolveSetting('break.seeding', chain, rows, format).value,
  'break.double_qualifier': resolveSetting(
    'break.double_qualifier',
    chain,
    rows,
    format,
  ).value,
});
