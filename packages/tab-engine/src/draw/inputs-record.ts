import {
  canonicalJson,
  canonicalOrder,
  compareBytes,
  digestOf,
  hexOf,
} from '@daisy/seeded-random';
import type { DrawInput, InputsRecord, Judge } from '../shapes/draw';
import type { ResolvedSettings, SettingKey } from '../shapes/settings';
import type { Prepared } from './prepare';

/** Every key the engine reads; any other key in the input is ignored. */
const readKeys: Record<SettingKey, true> = {
  'pairing.method': true,
  'pairing.section_size': true,
  'pairing.rematch': true,
  'pairing.same_school': true,
  'pairing.side_balance': true,
  'pairing.side_alternation': true,
  'pairing.pull_up': true,
  'pairing.position_balance': true,
  'pairing.section_repeat': true,
  'pairing.preference_order': true,
  'bye.recipient': true,
  'bye.result': true,
  'bye.repeat': true,
  'judging.panel': true,
  'judging.availability': true,
  'judging.strike': true,
  'judging.conflict': true,
  'judging.same_school': true,
  'judging.repeat_judge': true,
  'judging.unsubmitted_ballot': true,
  'judging.load_balance': true,
  'judging.chair': true,
  'judging.panel_same_school': true,
  'judging.preference_order': true,
  'standings.tiebreaks': true,
  'break.line': true,
  'break.seeding': true,
  'break.double_qualifier': true,
};
/** A draw reads every key but the break keys, which only `breaks` reads. */
const engineSettingKeys = (Object.keys(readKeys) as SettingKey[])
  .filter((key) => !key.startsWith('break.'))
  .sort();

/** Only the keys the engine reads, so a key it does not read changes nothing. */
const settingsRead = (settings: ResolvedSettings) =>
  Object.fromEntries(
    engineSettingKeys.map((key) => [key, settings[key]]),
  ) as ResolvedSettings;

const ENGINE_VERSION = 'tab-engine@1';

export const inputsRecord = (
  prepared: Prepared,
  input: DrawInput,
  alongside: readonly Prepared[],
  versions: Readonly<Record<string, string>>,
): InputsRecord => {
  const request = prepared.request;
  const settings = settingsRead(request.settings);
  const judges: readonly Judge[] = input.judges ?? [];
  const common = {
    engine: { engine: ENGINE_VERSION, ...versions },
    settings,
    settingsDigest: digestOf(canonicalJson(settings)),
    seed: hexOf(input.seed),
    entriesDigest: digestOf(canonicalJson(canonicalOrder(request.entries))),
    judgesDigest: digestOf(canonicalJson(canonicalOrder(judges))),
    existing: canonicalOrder(
      request.existing.map((f) => ({ id: f.id, hold: f.hold })),
    ),
    ratings:
      request.ratings === null
        ? null
        : {
            ladder: request.ratings.ladder,
            takenAt: request.ratings.takenAt,
            calculation: request.ratings.calculation,
          },
    cutoff: prepared.cutoff,
    results: [...prepared.results].sort(compareBytes),
  };
  if (input.call === 'windowed') return { call: 'windowed', ...common };
  return {
    call: 'slot',
    ...common,
    slot: input.slot,
    commitments: canonicalOrder(
      input.commitments.map((c) => ({ id: c.fixture })),
    ).map((c) => c.id),
    alongside: alongside
      .filter((p) => p !== prepared)
      .map((p) => ({ event: p.request.event, tabRound: p.request.tabRound })),
  };
};
