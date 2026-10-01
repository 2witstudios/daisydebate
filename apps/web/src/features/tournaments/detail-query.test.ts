import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  defaultDetailQuery,
  detailHref,
  parseDetailQuery,
} from './detail-query';

setupRitewayBun();

describe('parseDetailQuery', () => {
  test('defaults, valid and hostile values', () => {
    assert({
      given: 'no params, valid params, and junk',
      should: 'default, parse, then default again',
      actual: [
        parseDetailQuery({}),
        parseDetailQuery({ tab: 'entrants', all: '1' }),
        parseDetailQuery({ tab: ['rules', 'bracket'], all: 'yes' }),
        parseDetailQuery({ tab: 'admin', all: ['1'] }),
      ],
      expected: [
        defaultDetailQuery,
        { tab: 'entrants', all: true },
        { tab: 'rules', all: false },
        { tab: 'overview', all: true },
      ],
    });
  });
});

describe('detailHref', () => {
  test('only non-default values are carried', () => {
    assert({
      given: 'the default, a tab and a tab with all',
      should: 'build the shortest URL',
      actual: [
        detailHref('autumn-open', defaultDetailQuery),
        detailHref('autumn-open', { tab: 'rules', all: false }),
        detailHref('autumn-open', { tab: 'entrants', all: true }),
      ],
      expected: [
        '/tournaments/autumn-open',
        '/tournaments/autumn-open?tab=rules',
        '/tournaments/autumn-open?tab=entrants&all=1',
      ],
    });
  });
});
