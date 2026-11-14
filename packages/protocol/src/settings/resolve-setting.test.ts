import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  settingsCatalogue,
  type SettingRow,
  type SettingScope,
} from './catalogue';
import { pairingPresets } from './pairing-presets';
import {
  enforcedConflict,
  eventChain,
  resolveSetting,
  resolveSettings,
  roomChain,
  withoutSettingRow,
  withSettingRow,
} from './resolve-setting';
import { settingKeySchema, type SettingKey } from './setting-values';
import {
  formatDefaults,
  otherValues,
  row,
  scope,
} from './settings.test-support';

setupRitewayBun();

const keys = settingKeySchema.options;
const chain = eventChain({
  template: { id: 'template', organizationId: 'template-owner' },
  leagueId: 'league',
  lobbyId: 'tournament',
  eventId: 'event',
});
const [templateOwner, template, league, tournament, event] = chain as [
  SettingScope,
  SettingScope,
  SettingScope,
  SettingScope,
  SettingScope,
];
/** One key that defaults to Daisy's value, one to the preset and one to the format. */
const modelKeys = ['entry.cap', 'pairing.rematch', 'room.timing'] as const;
const values = (key: SettingKey) => ({
  a: otherValues[key],
  b: resolveSetting(key, [], [], formatDefaults).value,
});
type Cell = null | {
  readonly value: 'a' | 'b';
  readonly hold: SettingRow['hold'];
};
const upper: readonly Cell[] = [
  null,
  { value: 'a', hold: 'default' },
  { value: 'b', hold: 'default' },
  { value: 'a', hold: 'enforced' },
  { value: 'b', hold: 'enforced' },
];
const lowest = upper.slice(0, 3);
/** Every chain of rows for one key: absent, or either value at either hold, per scope. */
const cellChains: Cell[][] = [upper, upper, upper, upper, lowest].reduce<
  Cell[][]
>(
  (chains, options) =>
    chains.flatMap((cells) => options.map((cell) => [...cells, cell])),
  [[]],
);
const rowsOf = (
  key: SettingKey,
  cells: readonly Cell[],
  scopes = chain,
): SettingRow[] =>
  cells.flatMap((cell, index) =>
    cell ? [row(scopes[index]!, key, values(key)[cell.value], cell.hold)] : [],
  );
const enforcedValues = (cells: readonly Cell[]) =>
  new Set(
    cells
      .filter((cell) => cell?.hold === 'enforced')
      .map((cell) => cell!.value),
  );
const agreeing = cellChains.filter((cells) => enforcedValues(cells).size < 2);
const resolve = (
  key: SettingKey,
  rows: readonly SettingRow[],
  scopes = chain,
) => resolveSetting(key, scopes, rows, formatDefaults);
const failures = (
  check: (key: SettingKey, cells: Cell[]) => boolean,
  over = agreeing,
) =>
  modelKeys.flatMap((key) => over.filter((cells) => !check(key, cells))).length;

describe('resolving a setting', () => {
  test('an enforced value wins', () => {
    assert({
      given: 'every chain of rows with an enforced one, for three kinds of key',
      should: 'resolve to that row’s value, held enforced, naming its scope',
      actual: failures((key, cells) => {
        const index = cells.findIndex((cell) => cell?.hold === 'enforced');
        if (index < 0) return true;
        const resolved = resolve(key, rowsOf(key, cells));
        return (
          resolved.value === values(key)[cells[index]!.value] &&
          resolved.hold === 'enforced' &&
          resolved.source === chain[index]
        );
      }),
      expected: 0,
    });
  });
  test('otherwise the lowest row wins, and an empty chain gives the default', () => {
    assert({
      given: 'every chain with no enforced row',
      should:
        'resolve to the lowest row, held default, or to the key’s default',
      actual: failures((key, cells) => {
        if (enforcedValues(cells).size > 0) return true;
        const index = cells.map((cell) => cell !== null).lastIndexOf(true);
        const resolved = resolve(key, rowsOf(key, cells));
        return index < 0
          ? resolved.value === values(key).b && resolved.hold === 'default'
          : resolved.value === values(key)[cells[index]!.value] &&
              resolved.hold === 'default' &&
              resolved.source === chain[index];
      }),
      expected: 0,
    });
  });
  test('names where an unset value came from', () => {
    const lobbyPreset = [
      row(tournament, 'pairing.preset', { value: 'round_robin' }),
    ];
    assert({
      given: 'an empty chain, and a chain whose lobby picks another preset',
      should: 'name the catalogue, the preset or the format',
      actual: [
        resolve('entry.cap', []),
        resolve('pairing.rematch', []),
        resolve('pairing.rematch', lobbyPreset),
        resolve('bye.result', lobbyPreset),
        resolve('room.timing', []),
      ],
      expected: [
        {
          key: 'entry.cap',
          hold: 'default',
          value: { perEvent: null, perSchool: null },
          source: { kind: 'catalogue' },
        },
        {
          key: 'pairing.rematch',
          hold: 'default',
          value: { force: 'rule' },
          source: { kind: 'preset', preset: 'swiss_power' },
        },
        {
          key: 'pairing.rematch',
          hold: 'default',
          value: { force: 'off' },
          source: { kind: 'preset', preset: 'round_robin' },
        },
        {
          key: 'bye.result',
          hold: 'default',
          value: { value: 'own_average' },
          source: { kind: 'preset', preset: 'round_robin' },
        },
        {
          key: 'room.timing',
          hold: 'default',
          value: formatDefaults['room.timing'],
          source: { kind: 'format' },
        },
      ],
    });
    assert({
      given: 'an organization’s own pairing row under a host’s preset',
      should: 'keep the organization’s value and take the preset for the rest',
      actual: [
        resolve('pairing.rematch', [
          ...lobbyPreset,
          row(league, 'pairing.rematch', { force: 'warning' }, 'enforced'),
        ]).value,
        resolve('pairing.same_school', [
          ...lobbyPreset,
          row(league, 'pairing.rematch', { force: 'warning' }, 'enforced'),
        ]).value,
      ],
      expected: [
        { force: 'warning' },
        pairingPresets.round_robin['pairing.same_school'],
      ],
    });
  });
  test('every catalogue key resolves', () => {
    const resolved = resolveSettings(chain, [], formatDefaults);
    assert({
      given: 'an event with no row at all',
      should: 'resolve every key to a value its schema accepts',
      actual: keys.filter(
        (key) =>
          !settingsCatalogue[key].value.safeParse(resolved[key].value).success,
      ),
      expected: [],
    });
    assert({
      given:
        'every key set once at each scope it allows, with nothing else set',
      should: 'resolve to that row from that scope',
      actual: keys.flatMap((key) =>
        chain
          .filter((at) => settingsCatalogue[key].scopes.includes(at.kind))
          .filter((at) => {
            const resolved = resolve(key, [row(at, key, otherValues[key])]);
            return (
              resolved.value !== otherValues[key] || resolved.source !== at
            );
          })
          .map((at) => `${key} at ${at.id}`),
      ),
      expected: [],
    });
  });
  test('the order of the upper levels never matters', () => {
    const orders = [
      [0, 1, 2, 3],
      [3, 2, 1, 0],
      [1, 0, 3, 2],
      [2, 3, 0, 1],
      [1, 2, 3, 0],
      [3, 0, 1, 2],
    ];
    assert({
      given:
        'every chain whose enforced rows agree, with its four upper scopes in six orders',
      should:
        'resolve to the same value and hold whenever an enforced row or the event’s row decides',
      actual: failures((key, cells) => {
        if (enforcedValues(cells).size === 0 && cells[4] === null) return true;
        const rows = rowsOf(key, cells);
        const { value, hold } = resolve(key, rows);
        return orders.every((order) => {
          const reordered = resolve(key, rows, [
            ...order.map((index) => chain[index]!),
            event,
          ]);
          return reordered.value === value && reordered.hold === hold;
        });
      }),
      expected: 0,
    });
  });
  test('rows outside the chain are not read', () => {
    const elsewhere = [
      row(
        scope('organization', 'another-league'),
        'entry.cap',
        otherValues['entry.cap'],
        'enforced',
      ),
      row(
        scope('event', 'another-event'),
        'entry.cap',
        otherValues['entry.cap'],
      ),
    ];
    assert({
      given: 'rows at another organization and another event',
      should: 'resolve as if they were not there',
      actual: resolve('entry.cap', elsewhere),
      expected: resolve('entry.cap', []),
    });
  });
  test('builds the two chains the architecture names', () => {
    assert({
      given:
        'an event following a league’s own template, one following none under no league, and a Room',
      should: 'list each scope once, highest first',
      actual: [
        eventChain({
          template: { id: 't', organizationId: 'league' },
          leagueId: 'league',
          lobbyId: 'l',
          eventId: 'e',
        }),
        eventChain({
          template: null,
          leagueId: null,
          lobbyId: 'l',
          eventId: 'e',
        }),
        roomChain({ organizationId: 'o', templateId: 't', lobbyId: 'l' }),
        roomChain({ organizationId: 'o', templateId: null, lobbyId: 'l' }),
      ].map((scopes) => scopes.map((at) => `${at.kind}:${at.id}`)),
      expected: [
        ['organization:league', 'template:t', 'lobby:l', 'event:e'],
        ['lobby:l', 'event:e'],
        ['organization:o', 'template:t', 'lobby:l'],
        ['organization:o', 'lobby:l'],
      ],
    });
  });
});

describe('enforced values in one chain', () => {
  test('are refused exactly when two of them differ', () => {
    assert({
      given: 'every chain of rows, for three kinds of key',
      should:
        'find a conflict exactly in the chains with two different enforced values',
      actual: failures(
        (key, cells) =>
          (enforcedConflict(key, chain, rowsOf(key, cells)) !== null) ===
          (enforcedValues(cells).size === 2),
        cellChains,
      ),
      expected: 0,
    });
  });
  test('name the key and both scopes', () => {
    const rows = [
      row(
        templateOwner,
        'entry.cap',
        { perEvent: 32, perSchool: null },
        'enforced',
      ),
      row(template, 'entry.cap', { perSchool: null, perEvent: 32 }, 'enforced'),
    ];
    const added = row(
      league,
      'entry.cap',
      { perEvent: 64, perSchool: null },
      'enforced',
    );
    assert({
      given:
        'two scopes enforcing the same value in a different key order, then a league enforcing another',
      should:
        'accept the first chain and refuse the row that disagrees, wherever it sits',
      actual: [
        enforcedConflict('entry.cap', chain, rows),
        enforcedConflict('entry.cap', chain, withSettingRow(rows, added)),
        enforcedConflict(
          'entry.cap',
          chain,
          withSettingRow(rows, { ...added, hold: 'default' }),
        ),
        enforcedConflict(
          'entry.cap',
          [tournament, event],
          withSettingRow(rows, added),
        ),
        enforcedConflict('entry.approval', chain, withSettingRow(rows, added)),
      ],
      expected: [
        null,
        { key: 'entry.cap', scopes: [templateOwner, league] },
        null,
        null,
        null,
      ],
    });
  });
  test('setting then clearing a row restores the earlier resolution', () => {
    assert({
      given:
        'every agreeing chain, with a row set at each scope and then cleared',
      should: 'resolve as before the row was set',
      actual: failures((key, cells) => {
        const rows = rowsOf(key, cells);
        return chain.every((at) => {
          const before = withoutSettingRow(rows, at, key);
          const after = withoutSettingRow(
            withSettingRow(before, row(at, key, otherValues[key])),
            at,
            key,
          );
          return (
            JSON.stringify(resolve(key, after)) ===
            JSON.stringify(resolve(key, before))
          );
        });
      }),
      expected: 0,
    });
    assert({
      given: 'a row set twice at one scope',
      should: 'leave one row there, the later one',
      actual: withSettingRow(
        withSettingRow([], row(event, 'entry.approval', { value: 'host' })),
        row(event, 'entry.approval', { value: 'automatic' }),
      ),
      expected: [row(event, 'entry.approval', { value: 'automatic' })],
    });
  });
});
