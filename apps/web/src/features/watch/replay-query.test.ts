import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  defaultReplayQuery,
  parseReplayQuery,
  replayHiddenFields,
  replayQueryHref,
} from './replay-query';

setupRitewayBun();

describe('parseReplayQuery', () => {
  test('defaults and valid values', () => {
    assert({
      given: 'nothing, then every parameter',
      should: 'default, then read them',
      actual: [
        parseReplayQuery({}),
        parseReplayQuery({
          t: '90',
          q: ' gap ',
          speed: '2',
          pane: 'share',
          manage: '1',
          vis: 'unlisted',
        }),
      ],
      expected: [
        defaultReplayQuery,
        {
          t: 90,
          q: 'gap',
          speed: '2',
          pane: 'share',
          manage: true,
          vis: 'unlisted',
        },
      ],
    });
  });

  test('untrusted values', () => {
    assert({
      given: 'negative, fractional, huge and junk values',
      should: 'fall back to the defaults',
      actual: [
        parseReplayQuery({ t: '-5' }),
        parseReplayQuery({ t: '1.5' }),
        parseReplayQuery({ t: '99999999' }),
        parseReplayQuery({
          speed: '9',
          pane: 'admin',
          manage: 'yes',
          vis: 'secret',
        }),
      ],
      expected: [
        defaultReplayQuery,
        defaultReplayQuery,
        defaultReplayQuery,
        defaultReplayQuery,
      ],
    });
  });
});

describe('replayQueryHref', () => {
  test('only non-default values', () => {
    assert({
      given: 'default and changed queries',
      should: 'build the shortest replay URL',
      actual: [
        replayQueryHref('a', defaultReplayQuery),
        replayQueryHref('a', { ...defaultReplayQuery, t: 0 }),
        replayQueryHref('a', {
          ...defaultReplayQuery,
          pane: 'share',
          manage: true,
          vis: 'private',
        }),
      ],
      expected: [
        '/recordings/a',
        '/recordings/a?t=0',
        '/recordings/a?pane=share&manage=1&vis=private',
      ],
    });
  });
});

describe('replayHiddenFields', () => {
  test('keeps the state the form does not edit', () => {
    assert({
      given:
        'a query with a search, speed and open manager, and a form editing t and speed',
      should: 'carry the search and the manager only',
      actual: replayHiddenFields(
        { ...defaultReplayQuery, t: 5, q: 'gap', speed: '2', manage: true },
        ['t', 'speed'],
      ),
      expected: [
        ['q', 'gap'],
        ['manage', '1'],
      ],
    });
  });
});
