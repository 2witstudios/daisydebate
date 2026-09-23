import { join } from 'node:path';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { tiles } from './tiles';
import { statusDotClass } from '../components/status-line/status-line-class';
import { actionTileTintClass } from './action-tile/action-tile-class';
import { routeExists } from '../test-support/route-exists';

setupRitewayBun();

const appDirectory = join(import.meta.dir, '../../app');

describe('tile destinations', () => {
  test('point at routes that exist', () => {
    assert({
      given: 'the tile configuration',
      should: 'have an app router page for every destination',
      actual: tiles
        .map((tile) => tile.href)
        .filter((href) => !routeExists(appDirectory, href)),
      expected: [],
    });
  });

  test('use only tints and tones the class functions define', () => {
    assert({
      given: 'every tint and status tone in use, including the neutral default',
      should: 'resolve to a real class, never "undefined"',
      actual: [
        ...tiles.map((tile) => actionTileTintClass(tile.tint ?? 'neutral')),
        ...tiles.map((tile) => statusDotClass(tile.status?.tone ?? 'neutral')),
      ].filter(
        (classes) => classes === undefined || classes.includes('undefined'),
      ),
      expected: [],
    });
  });
});
