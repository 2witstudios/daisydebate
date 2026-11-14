import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { parseOutcome } from '../parse-outcome.test-support';
import {
  settingRowSchema,
  settingScopeKinds,
  settingsCatalogue,
  type SettingDefinition,
} from './catalogue';
import { forceKeys, forces } from './force';
import { pairingPresets } from './pairing-presets';
import { settingKeySchema, type SettingKey } from './setting-values';
import {
  formatDefaults,
  otherValues,
  row,
  scope,
} from './settings.test-support';

setupRitewayBun();

const keys = settingKeySchema.options;
const definitions: readonly SettingDefinition[] = keys.map(
  (key) => settingsCatalogue[key],
);
const where = (keep: (definition: SettingDefinition) => boolean) =>
  definitions.filter(keep).map((definition) => definition.key);
const isObject = (value: unknown) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const parses = (key: SettingKey, value: unknown) =>
  settingsCatalogue[key].value.safeParse(value).success;
const presetKeys = keys.filter(
  (key) =>
    (key.startsWith('pairing.') && key !== 'pairing.preset') ||
    key.startsWith('bye.'),
);
const families = (...prefixes: string[]) =>
  keys.filter((key) => prefixes.some((prefix) => key.startsWith(prefix)));

describe('the settings catalogue', () => {
  test('defines every key with a schema, scopes, a default and a hold rule', () => {
    assert({
      given: 'every key',
      should:
        'have a schema, at least one known scope, a default and a stated hold rule',
      actual: where(
        (definition) =>
          !(
            typeof definition.value.safeParse === 'function' &&
            definition.scopes.length > 0 &&
            definition.scopes.every((kind) =>
              settingScopeKinds.includes(kind),
            ) &&
            ['value', 'preset', 'format'].includes(definition.default.kind) &&
            typeof definition.enforceable === 'boolean' &&
            ['event', 'room', 'both'].includes(definition.chains)
          ),
      ),
      expected: [],
    });
    assert({
      given: 'the closed families',
      should: 'hold exactly the keys a screen shows and a table stores',
      actual: families('ballot.', 'resolution.', 'room.'),
      expected: [
        'ballot.screening',
        'resolution.rule',
        'resolution.own_text',
        'room.own_format',
        'room.visibility',
        'room.timing',
        'room.floor',
      ],
    });
  });

  test('every value and default is a JSON object that parses', () => {
    const defaults = definitions.map((definition) => {
      if (definition.default.kind === 'value')
        return [definition.default.value];
      if (definition.default.kind === 'format')
        return [formatDefaults[definition.key as keyof typeof formatDefaults]];
      return Object.values(pairingPresets).map(
        (preset) => preset[definition.key as keyof typeof preset],
      );
    });
    assert({
      given:
        'each key’s default (Daisy’s, each preset’s, or a format’s) and another valid value',
      should: 'parse under the key’s schema and be an object',
      actual: keys.filter(
        (key, index) =>
          ![...defaults[index]!, otherValues[key]].every(
            (value) => isObject(value) && parses(key, value),
          ),
      ),
      expected: [],
    });
    assert({
      given:
        'a bare string, a bare list and an object with an unknown field, for every key',
      should: 'refuse all three',
      actual: keys.filter(
        (key) =>
          parses(key, 'rule') ||
          parses(key, [otherValues[key]]) ||
          parses(key, { ...otherValues[key], extra: true }),
      ),
      expected: [],
    });
  });

  test('every pairing preset covers every pairing and bye key', () => {
    assert({
      given: 'the three presets',
      should:
        'each hold exactly the pairing keys but the preset itself, and the bye keys',
      actual: Object.values(pairingPresets).map((preset) =>
        Object.keys(preset).sort(),
      ),
      expected: Array(3).fill([...presetKeys].sort()),
    });
    assert({
      given: 'the keys that fall back to the preset',
      should: 'be those same keys, set only by an organization or its template',
      actual: [
        where((definition) => definition.default.kind === 'preset'),
        where(
          (definition) =>
            definition.default.kind === 'preset' &&
            definition.scopes.join() !== 'organization,template',
        ),
        Object.keys(pairingPresets),
      ],
      expected: [presetKeys, [], ['swiss_power', 'random', 'round_robin']],
    });
  });

  test('a key that carries a force accepts exactly the forces it lists', () => {
    const forceKeyNames = Object.keys(forceKeys) as (keyof typeof forceKeys)[];
    const withForce = (key: SettingKey, force: string) => ({
      ...otherValues[key],
      force,
    });
    assert({
      given: 'the keys whose value has a force field',
      should:
        'be the seventeen that list their forces, and no other key lists any',
      actual: [
        where((definition) => definition.forces !== null),
        keys.filter((key) => 'force' in otherValues[key]),
      ],
      expected: [forceKeyNames, forceKeyNames],
    });
    assert({
      given: 'every force tried on every force key',
      should: 'accept the listed ones and refuse the rest',
      actual: forceKeyNames.map((key) =>
        forces.filter((force) => parses(key, withForce(key, force))),
      ),
      expected: forceKeyNames.map((key) =>
        forces.filter((force) =>
          (forceKeys[key] as readonly string[]).includes(force),
        ),
      ),
    });
    assert({
      given: 'a preference order that leaves a key out, or names one twice',
      should: 'be refused',
      actual: [
        parseOutcome(settingsCatalogue['judging.preference_order'].value, {
          order: otherValues['judging.preference_order'].order.slice(1),
        }),
        parseOutcome(settingsCatalogue['pairing.preference_order'].value, {
          order: [
            ...otherValues['pairing.preference_order'].order.slice(1),
            'pairing.rematch',
            'pairing.rematch',
          ].slice(1),
        }),
      ],
      expected: [{ issues: ['order'] }, { issues: ['order'] }],
    });
  });

  test('a value that differs by stage is one object keyed by stage kind', () => {
    assert({
      given: 'the pairing method and the panel',
      should:
        'hold a preliminary and an elimination value, and refuse either alone',
      actual: (['pairing.method', 'judging.panel'] as const).map((key) => {
        const { preliminary, elimination } = otherValues[key];
        return [
          Object.keys(otherValues[key]),
          parses(key, { preliminary }),
          parses(key, { elimination }),
        ];
      }),
      expected: Array(2).fill([['preliminary', 'elimination'], false, false]),
    });
    assert({
      given: 'the scope kinds',
      should: 'have no stage',
      actual: settingScopeKinds,
      expected: ['organization', 'template', 'lobby', 'event'],
    });
  });

  test('a tiebreak is named once, a panel is odd, and a division key is unique', () => {
    const tiebreaks = settingsCatalogue['standings.tiebreaks'].value;
    assert({
      given:
        'a tiebreak named twice, no tiebreak, an unknown metric, an even panel and a repeated division',
      should: 'refuse each at its field',
      actual: [
        parseOutcome(tiebreaks, {
          metrics: ['wins', 'rating', 'wins'],
          minimumGames: null,
          terminal: 'lot',
        }),
        parseOutcome(tiebreaks, {
          metrics: [],
          minimumGames: null,
          terminal: 'lot',
        }),
        parseOutcome(tiebreaks, {
          metrics: ['luck'],
          minimumGames: null,
          terminal: 'lot',
        }),
        parseOutcome(settingsCatalogue['judging.panel'].value, {
          ...otherValues['judging.panel'],
          elimination: { size: 2, decision: 'majority' },
        }),
        parseOutcome(settingsCatalogue['entry.divisions'].value, {
          items: [
            otherValues['entry.divisions'].items[0],
            otherValues['entry.divisions'].items[0],
          ],
        }),
        parseOutcome(settingsCatalogue['entry.registration'].value, {
          state: 'window',
          opensAt: '2026-11-20T12:00:00.000Z',
          closesAt: '2026-11-13T12:00:00.000Z',
        }),
        parseOutcome(settingsCatalogue['resolution.rule'].value, {
          method: 'strike',
          drawSize: 1,
          strikeWindowMs: 60_000,
          firstStriker: 2,
        }),
      ],
      expected: [
        { issues: ['metrics'] },
        { issues: ['metrics'] },
        { issues: ['metrics.0'] },
        { issues: ['elimination.size'] },
        { issues: ['items'] },
        { issues: ['(root)'] },
        { issues: ['drawSize', 'firstStriker'] },
      ],
    });
  });
});

describe('a setting row', () => {
  const kinds = settingScopeKinds;
  test('is set only at a scope its key allows', () => {
    assert({
      given: 'every key set at every scope',
      should: 'be accepted exactly at the scopes the catalogue lists',
      actual: keys.map((key) =>
        kinds.filter(
          (kind) =>
            settingRowSchema.safeParse(row(scope(kind), key, otherValues[key]))
              .success,
        ),
      ),
      expected: definitions.map((definition) =>
        kinds.filter((kind) => definition.scopes.includes(kind)),
      ),
    });
  });
  test('is enforced only above the event, and only where the key may be', () => {
    assert({
      given: 'every key enforced at every scope it allows',
      should:
        'be accepted everywhere but the event, except the keys that cannot be enforced',
      actual: keys.map((key) =>
        kinds.filter(
          (kind) =>
            settingRowSchema.safeParse(
              row(scope(kind), key, otherValues[key], 'enforced'),
            ).success,
        ),
      ),
      expected: definitions.map((definition) =>
        kinds.filter(
          (kind) =>
            definition.scopes.includes(kind) &&
            kind !== 'event' &&
            definition.enforceable,
        ),
      ),
    });
    assert({
      given: 'the keys that may not be enforced',
      should: 'be registration and the staff band',
      actual: where((definition) => !definition.enforceable),
      expected: ['entry.registration', 'staff.minimum_band'],
    });
  });
  test('holds a value that fits its key', () => {
    assert({
      given:
        'a force the key does not list, an unknown key, an unknown field and a valid row',
      should: 'name the field refused, and return the valid row unchanged',
      actual: [
        parseOutcome(
          settingRowSchema,
          row(scope('organization'), 'pairing.pull_up', {
            ...otherValues['pairing.pull_up'],
            force: 'rule' as never,
          }),
        ),
        parseOutcome(settingRowSchema, {
          ...row(scope('lobby'), 'entry.cap', otherValues['entry.cap']),
          key: 'entry.fee',
        }),
        parseOutcome(settingRowSchema, {
          ...row(scope('lobby'), 'entry.cap', otherValues['entry.cap']),
          note: 'x',
        }),
        parseOutcome(
          settingRowSchema,
          row(scope('lobby'), 'entry.cap', otherValues['entry.cap']),
        ),
      ],
      expected: [
        { issues: ['value.force'] },
        { issues: ['key'] },
        { issues: ['(root)'] },
        { data: row(scope('lobby'), 'entry.cap', otherValues['entry.cap']) },
      ],
    });
  });
});
