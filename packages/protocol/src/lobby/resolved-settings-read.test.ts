import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { parseEach, parseOutcome } from '../parse-outcome.test-support';
import {
  resolvedSettingEntrySchema,
  resolvedSettingsGateOf,
  resolvedSettingsQuerySchema,
  resolvedSettingsReadCatalogue,
  resolvedSettingsViewSchema,
  settingKeyFamilies,
  settingsAtSchema,
} from './resolved-settings-read';

setupRitewayBun();

const id = (name: string) => name.padEnd(24, '0');
const entry = {
  key: 'recording.capture',
  value: { value: 'on' },
  source: { kind: 'organization', id: id('league'), name: 'Southeast League' },
  hold: 'enforced',
  own: null,
  locked: 'enforced',
} as const;

describe('resolved-settings read', async () => {
  test('where it is asked', () => {
    assert({
      given: 'each kind of place, and an id that is not one',
      should: 'accept the places and refuse the id',
      actual: parseEach(settingsAtSchema, [
        { kind: 'organization', id: id('a') },
        { kind: 'template', id: id('a') },
        { kind: 'lobby', id: id('a') },
        { kind: 'event', id: id('a') },
        { kind: 'room_draft', lobbyId: id('a'), templateId: null },
        { kind: 'lobby', id: 'Autumn' },
      ]).map((outcome) => 'data' in outcome),
      expected: [true, true, true, true, true, false],
    });
    assert({
      given: 'a query with a family, with an unknown family, with an extra key',
      should: 'accept only the first',
      actual: parseEach(resolvedSettingsQuerySchema, [
        { at: { kind: 'event', id: id('e') }, family: 'audience' },
        { at: { kind: 'event', id: id('e') }, family: 'stage' },
        { at: { kind: 'event', id: id('e') }, page: 2 },
      ]).map((outcome) => 'data' in outcome),
      expected: [true, false, false],
    });
    assert({
      given: 'the catalogue keys',
      should: 'derive each family once',
      actual: settingKeyFamilies.includes('pairing') && settingKeyFamilies.includes('staff'),
      expected: true,
    });
  });

  test('an entry', () => {
    assert({
      given: 'an enforced entry, a default from the catalogue, a value the key refuses, an enforced default, an unknown lock',
      should: 'accept the first two and refuse the rest where they are wrong',
      actual: [
        parseOutcome(resolvedSettingEntrySchema, entry),
        parseOutcome(resolvedSettingEntrySchema, {
          ...entry,
          source: { kind: 'catalogue' },
          hold: 'default',
          locked: null,
          own: { value: { value: 'off' }, hold: 'default' },
        }),
        parseOutcome(resolvedSettingEntrySchema, { ...entry, value: { value: 'maybe' } }),
        parseOutcome(resolvedSettingEntrySchema, { ...entry, source: { kind: 'catalogue' } }),
        parseOutcome(resolvedSettingEntrySchema, { ...entry, locked: 'frozen' }),
      ].map((outcome) => ('data' in outcome ? 'ok' : outcome.issues)),
      expected: ['ok', 'ok', ['value.value'], ['hold'], ['locked']],
    });
  });

  test('a view', () => {
    const at = { kind: 'room_draft', lobbyId: id('lobby'), templateId: id('t') };
    assert({
      given: 'a view, one repeating a key, a draft with an own row, and an unknown key',
      should: 'accept only the first',
      actual: [
        parseOutcome(resolvedSettingsViewSchema, { at, settings: [entry] }),
        parseOutcome(resolvedSettingsViewSchema, { at, settings: [entry, entry] }),
        parseOutcome(resolvedSettingsViewSchema, {
          at,
          settings: [{ ...entry, own: { value: { value: 'on' }, hold: 'default' } }],
        }),
        parseOutcome(resolvedSettingsViewSchema, { at, settings: [], extra: true }),
      ].map((outcome) => 'data' in outcome),
      expected: [true, false, false, false],
    });
  });

  test('the gate', () => {
    assert({
      given: 'each place',
      should: 'be read under the read capability of what is asked about',
      actual: [
        resolvedSettingsGateOf({ kind: 'organization', id: id('a') }),
        resolvedSettingsGateOf({ kind: 'template', id: id('a') }),
        resolvedSettingsGateOf({ kind: 'event', id: id('a') }),
        resolvedSettingsGateOf({ kind: 'room_draft', lobbyId: id('a'), templateId: null }),
        resolvedSettingsReadCatalogue.ResolvedSettingsView.gate,
      ],
      expected: [
        'organization.read',
        'template.read',
        'lobby.read',
        'lobby.read',
        ['organization.read', 'template.read', 'lobby.read'],
      ],
    });
  });
});
