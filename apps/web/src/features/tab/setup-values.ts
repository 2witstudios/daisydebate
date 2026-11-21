import { createAppError } from '@daisy/errors';
import type { ResolvedSettingsView } from '@daisy/protocol/lobby/resolved-settings-read';
import {
  settingValueSchemas,
  type SettingKey,
  type SettingValues,
} from '@daisy/protocol/setting-values';
import { resolvedEntry } from './reads/resolved-settings';

export const setupValue = <Key extends SettingKey>(
  view: ResolvedSettingsView,
  key: Key,
): SettingValues[Key] => {
  const entry = resolvedEntry(view, key);
  if (!entry)
    throw createAppError('INVARIANT', 'An event setup setting is missing');
  return settingValueSchemas[key].parse(entry.value) as SettingValues[Key];
};
export const presetLabels = {
  swiss_power: 'Power-matched',
  random: 'Random',
  round_robin: 'Round robin',
} as const;
const words = (value: string): string => value.replaceAll('_', ' ');
const releaseLabels = {
  at_once: 'at once',
  after_round: 'after the round',
  after_prelims: 'after prelims',
  at_break: 'at the break',
  after_event: 'after the event',
  never: 'never',
};
const audienceWords = (values: Readonly<Record<string, string>>): string =>
  Object.entries(values)
    .map(
      ([audience, release]) =>
        `${words(audience)}: ${release in releaseLabels ? releaseLabels[release as keyof typeof releaseLabels] : words(release)}`,
    )
    .join(' · ');
export const pairingSummary = (view: ResolvedSettingsView): string => {
  const { preliminary } = setupValue(view, 'pairing.method');
  if (preliminary.structure === 'round_robin')
    return 'Everyone meets everyone.';
  const first =
    preliminary.first === 'random'
      ? 'Round 1 is random.'
      : 'Round 1 is seeded.';
  const later =
    preliminary.structure === 'powered'
      ? `Later rounds pair by record (${words(preliminary.later)}).`
      : `Later rounds are set in advance (${words(preliminary.later)}).`;
  return `${first} ${later}${preliminary.lag ? ` Standings leave out the latest ${preliminary.lag} rounds.` : ''}`;
};
export const setupSettingWords = (view: ResolvedSettingsView) => {
  const panel = setupValue(view, 'judging.panel');
  const resolution = setupValue(view, 'resolution.rule');
  const tie = setupValue(view, 'standings.tiebreaks');
  const conflict = setupValue(view, 'conflict.handling').value;
  return {
    'judging.panel': `${panel.preliminary.size} per room in prelims (${words(panel.preliminary.decision)}) · ${panel.elimination.size} in eliminations (${words(panel.elimination.decision)})`,
    'resolution.rule':
      resolution.method === 'strike'
        ? `Each room strikes from ${resolution.drawSize} resolutions`
        : resolution.method === 'draw'
          ? 'A resolution is drawn for each room'
          : 'A fixed resolution for each round',
    'pairing.preset': presetLabels[setupValue(view, 'pairing.preset').value],
    'standings.tiebreaks': `${tie.metrics.map(words).join(' → ')} · ${tie.terminal === 'lot' ? 'then lot' : 'then shared place'}${tie.minimumGames === null ? '' : ` · minimum ${tie.minimumGames} games`}`,
    'recording.capture':
      setupValue(view, 'recording.capture').value === 'on'
        ? 'Recorded'
        : 'Not recorded',
    'conflict.handling':
      conflict === 'second_confirms'
        ? 'A second person confirms'
        : words(conflict),
    'audience.posting': audienceWords(setupValue(view, 'audience.posting')),
    'audience.decision': audienceWords(setupValue(view, 'audience.decision')),
    'audience.scores': audienceWords(setupValue(view, 'audience.scores')),
    'audience.reason': audienceWords(setupValue(view, 'audience.reason')),
    'audience.feedback': audienceWords(setupValue(view, 'audience.feedback')),
    'audience.video': audienceWords(setupValue(view, 'audience.video')),
  };
};
