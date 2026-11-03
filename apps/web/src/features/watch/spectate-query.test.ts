import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  defaultSpectateQuery,
  parseSpectateQuery,
  spectateHref,
} from './spectate-query';

setupRitewayBun();

describe('parseSpectateQuery', () => {
  test('defaults and valid values', () => {
    assert({
      given: 'no parameters, then a pane',
      should: 'default to the transcript, then read it',
      actual: [parseSpectateQuery({}), parseSpectateQuery({ pane: 'chat' })],
      expected: [defaultSpectateQuery, { pane: 'chat' }],
    });
  });

  test('untrusted values', () => {
    assert({
      given: 'an unknown pane',
      should: 'fall back to the default',
      actual: parseSpectateQuery({ pane: 'admin' }),
      expected: defaultSpectateQuery,
    });
  });
});

describe('spectateHref', () => {
  test('carries only non-default values', () => {
    assert({
      given: 'queries with and without non-defaults',
      should: 'build the shortest live URL',
      actual: [
        spectateHref('top', defaultSpectateQuery),
        spectateHref('top', { pane: 'chat' }),
      ],
      expected: ['/watch/top', '/watch/top?pane=chat'],
    });
  });
});
