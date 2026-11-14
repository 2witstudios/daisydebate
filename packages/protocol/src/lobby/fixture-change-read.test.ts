import { assert, setupRitewayBun, test } from 'riteway/bun';
import { parseOutcome } from '../parse-outcome.test-support';
import {
  fixtureChangeListQuerySchema,
  fixtureChangeListSchema,
  fixtureChangeReadCatalogue,
} from './fixture-change-read';

setupRitewayBun();

const id = (letter: string) => letter.repeat(24);
const tabRoundId = id('t');
const added = {
  kind: 'added',
  fixtureId: id('f'),
  tabRoundId,
  drawVersion: 1,
  people: [id('a'), id('b'), id('j')],
} as const;
const officiated = {
  kind: 'officiated',
  fixtureId: id('f'),
  tabRoundId,
  commandId: id('c'),
  type: 'replace-judge',
  people: [id('a'), id('j'), id('k')],
} as const;

test('fixture change list', () => {
  const all = {
    seen: 'all',
    tabRoundId,
    changes: [added, officiated],
    nextCursor: 'after:2',
  };
  assert({
    given: 'the list an official sees',
    should: 'parse to itself',
    actual: parseOutcome(fixtureChangeListSchema, all),
    expected: { data: all },
  });

  const touching = {
    seen: 'touching',
    tabRoundId,
    changes: [{ ...officiated, people: [id('a')] }],
    nextCursor: null,
  };
  assert({
    given: 'the list a person sees, cut to the changes that touch them',
    should: 'parse to itself',
    actual: parseOutcome(fixtureChangeListSchema, touching),
    expected: { data: touching },
  });

  assert({
    given: 'a change of another tab round',
    should: 'reject the changes',
    actual: parseOutcome(fixtureChangeListSchema, {
      ...all,
      changes: [{ ...added, tabRoundId: id('u') }],
    }).issues,
    expected: ['changes'],
  });

  assert({
    given: 'a list that does not say how much the viewer sees',
    should: 'reject it',
    actual: parseOutcome(fixtureChangeListSchema, {
      tabRoundId,
      changes: [],
      nextCursor: null,
    }).issues,
    expected: ['seen'],
  });

  assert({
    given: 'a list with an unknown key',
    should: 'reject it (strict)',
    actual: parseOutcome(fixtureChangeListSchema, { ...all, previousDraw: 1 })
      .issues,
    expected: ['(root)'],
  });

  const query = { tabRoundId, cursor: null, limit: 50 };
  assert({
    given: 'a first-page query',
    should: 'parse to itself',
    actual: parseOutcome(fixtureChangeListQuerySchema, query),
    expected: { data: query },
  });

  assert({
    given: 'a query for more than a page holds',
    should: 'reject the limit',
    actual: parseOutcome(fixtureChangeListQuerySchema, { ...query, limit: 101 })
      .issues,
    expected: ['limit'],
  });

  assert({
    given: 'the read catalogue',
    should: 'gate the list on reading the posting',
    actual: fixtureChangeReadCatalogue.FixtureChangeList.gate,
    expected: ['posting.read'],
  });
});
