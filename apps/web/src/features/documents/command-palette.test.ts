import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  groupRanked,
  moveSelection,
  rankCommands,
  scoreCommand,
  type PaletteCommand,
} from './command-palette';

setupRitewayBun();

const command = (
  id: string,
  title: string,
  group = 'New',
  keywords: readonly string[] = [],
): PaletteCommand => ({ id, title, group, keywords });

const flow = command('flow', 'Flow', 'New', ['notes', 'sheet']);
const crossEx = command('cross-ex', 'Cross-ex notes', 'New', ['questions']);
const blank = command('blank', 'Blank document', 'New');
const open = command('open-flow', 'Open flow from library', 'Open');

describe('scoreCommand', () => {
  test('matching', () => {
    assert({
      given: 'an empty query',
      should: 'match with score 0 and no highlights',
      actual: scoreCommand('', flow),
      expected: { command: flow, score: 0, matches: [] },
    });
    assert({
      given: 'a query that is not a subsequence of title or keywords',
      should: 'not match',
      actual: scoreCommand('zz', flow),
      expected: null,
    });
    assert({
      given: 'a case-insensitive prefix',
      should: 'highlight the consecutive prefix range',
      actual: scoreCommand('FL', flow)?.matches,
      expected: [[0, 2]],
    });
    assert({
      given: 'a fuzzy query across words',
      should: 'highlight each matched run in the title',
      actual: scoreCommand('cn', crossEx)?.matches,
      expected: [
        [0, 1],
        [9, 10],
      ],
    });
    assert({
      given: 'a query that only matches a keyword',
      should: 'match with no title highlights',
      actual: scoreCommand('sheet', flow)?.matches,
      expected: [],
    });
  });

  test('bonuses', () => {
    const prefix = scoreCommand('fl', flow)?.score ?? 0;
    const inner = scoreCommand('fl', open)?.score ?? 0;
    assert({
      given: 'a prefix hit and a mid-title hit',
      should: 'score the prefix hit higher',
      actual: prefix > inner,
      expected: true,
    });
    const title = scoreCommand('notes', crossEx)?.score ?? 0;
    const keyword = scoreCommand('notes', flow)?.score ?? 0;
    assert({
      given: 'a title hit and a keyword-only hit',
      should: 'score the title hit higher',
      actual: title > keyword,
      expected: true,
    });
  });
});

describe('rankCommands', () => {
  test('ordering', () => {
    assert({
      given: 'an empty query',
      should: 'keep input order',
      actual: rankCommands('', [blank, flow, crossEx]).map((r) => r.command.id),
      expected: ['blank', 'flow', 'cross-ex'],
    });
    assert({
      given: 'a query matching some commands',
      should: 'drop non-matches and put the best first',
      actual: rankCommands('fl', [open, blank, flow]).map((r) => r.command.id),
      expected: ['flow', 'open-flow'],
    });
  });
});

describe('groupRanked', () => {
  test('first-appearance order', () => {
    const ranked = rankCommands('', [blank, open, flow]);
    assert({
      given: 'ranked commands from two groups',
      should: 'group them in first-appearance order',
      actual: groupRanked(ranked).map((g) => [
        g.group,
        g.items.map((i) => i.command.id),
      ]),
      expected: [
        ['New', ['blank', 'flow']],
        ['Open', ['open-flow']],
      ],
    });
  });
});

describe('moveSelection', () => {
  test('wrapping', () => {
    assert({
      given: 'moving down from the last item',
      should: 'wrap to the first',
      actual: moveSelection(2, 1, 3),
      expected: 0,
    });
    assert({
      given: 'moving up from the first item',
      should: 'wrap to the last',
      actual: moveSelection(0, -1, 3),
      expected: 2,
    });
    assert({
      given: 'an empty list',
      should: 'stay at 0',
      actual: moveSelection(4, 1, 0),
      expected: 0,
    });
  });
});
