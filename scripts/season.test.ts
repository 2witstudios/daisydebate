import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { parseSeasonCommand } from './season';

setupRitewayBun();

const now = '2026-10-05T12:00:00.000Z';
const id = 'k2v9x0f4m8q3w1z7c5n6b4d2';
const edge = { now, newId: () => id };

describe('parseSeasonCommand', () => {
  test('reads each command with the injected clock and id', () => {
    assert({
      given: 'list',
      should: 'list the seasons',
      actual: parseSeasonCommand(['list'], edge),
      expected: { kind: 'list' },
    });
    assert({
      given: 'open with a name and no start',
      should: 'open a new season starting now',
      actual: parseSeasonCommand(['open', '--name', 'Season 1'], edge),
      expected: {
        kind: 'open',
        season: { id, name: 'Season 1', startsAt: new Date(now) },
      },
    });
    assert({
      given: 'close with an id and an end',
      should: 'close that season at that end',
      actual: parseSeasonCommand(
        ['close', '--id', id, '--ends', '2026-12-31T00:00:00Z'],
        edge,
      ),
      expected: {
        kind: 'close',
        id,
        endsAt: new Date('2026-12-31T00:00:00Z'),
      },
    });
    assert({
      given: 'rollover with a name and a start',
      should: 'open the next season at that start',
      actual: parseSeasonCommand(
        ['rollover', '--name', 'Season 2', '--starts', '2027-01-01T00:00:00Z'],
        edge,
      ),
      expected: {
        kind: 'rollover',
        season: {
          id,
          name: 'Season 2',
          startsAt: new Date('2027-01-01T00:00:00Z'),
        },
      },
    });
  });

  test('refuses malformed input with usage', () => {
    const refusals = [
      ['an unknown command', ['reset']],
      ['no command', []],
      ['open without a name', ['open']],
      [
        'a start that is not ISO 8601',
        ['open', '--name', 'S', '--starts', 'tomorrow'],
      ],
      ['close with an id that is not a cuid2', ['close', '--id', 'season-1']],
      ['an unknown flag', ['list', '--force']],
    ] as const;
    for (const [given, argv] of refusals)
      assert({
        given,
        should: 'refuse with the usage text',
        actual: parseSeasonCommand(argv, edge).kind,
        expected: 'usage',
      });
  });
});
