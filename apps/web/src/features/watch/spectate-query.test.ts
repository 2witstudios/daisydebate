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
      given: 'no parameters, then a pane and a debate report',
      should: 'default to speeches with no dialog, then read them',
      actual: [
        parseSpectateQuery({}),
        parseSpectateQuery({ pane: 'chat', report: 'debate' }),
        parseSpectateQuery({ report: 'message:c4' }),
      ],
      expected: [
        defaultSpectateQuery,
        { pane: 'chat', report: { kind: 'debate' } },
        { pane: 'speeches', report: { kind: 'message', id: 'c4' } },
      ],
    });
  });

  test('untrusted values', () => {
    assert({
      given: 'an unknown pane and malformed report subjects',
      should: 'fall back to the defaults and open no dialog',
      actual: [
        parseSpectateQuery({ pane: 'admin' }),
        parseSpectateQuery({ report: 'message:<script>' }),
        parseSpectateQuery({ report: 'other' }),
      ],
      expected: [
        defaultSpectateQuery,
        defaultSpectateQuery,
        defaultSpectateQuery,
      ],
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
        spectateHref('top', {
          pane: 'chat',
          report: { kind: 'message', id: 'c4' },
        }),
        spectateHref('top', { pane: 'speeches', report: { kind: 'debate' } }),
      ],
      expected: [
        '/watch/top',
        '/watch/top?pane=chat&report=message%3Ac4',
        '/watch/top?report=debate',
      ],
    });
  });
});
