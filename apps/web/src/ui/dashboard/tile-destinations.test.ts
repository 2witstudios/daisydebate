import { join } from 'node:path';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  destinationHref,
  destinationSlugs,
} from '../../features/destinations/destinations';
import { tiles } from './tiles';
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

  test('every destination has a page at its route', () => {
    assert({
      given: 'each destination',
      should: 'have an app router page at its route',
      actual: destinationSlugs
        .map(destinationHref)
        .filter((href) => !routeExists(appDirectory, href)),
      expected: [],
    });
  });
});
