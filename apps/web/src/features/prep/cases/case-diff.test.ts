import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { Block, Speech } from './case';
import { diffCases, wordDiff } from './case-diff';
import { getCase } from './get-case';

setupRitewayBun();

const blk = (id: string, text?: string): Block => ({
  id,
  kind: 'brief',
  title: id.toUpperCase(),
  sub: 's',
  words: 10,
  ...(text === undefined ? {} : { text }),
});
const sp = (label: string, ...ids: string[]): Speech => ({
  id: label,
  label,
  blocks: ids.map((id) => blk(id)),
});

describe('wordDiff', () => {
  test('a replacement and an insertion', () => {
    assert({
      given: 'a sentence with one word swapped and a phrase added',
      should: 'keep, delete and insert whole words',
      actual: wordDiff(
        'Costs do not outweigh a rights claim',
        'Costs do not defeat a rights claim on the means',
      ).map((s) => [s.kind, s.text.trim()]),
      expected: [
        ['keep', 'Costs do not'],
        ['del', 'outweigh'],
        ['ins', 'defeat'],
        ['keep', 'a rights claim'],
        ['ins', 'on the means'],
      ],
    });
  });

  test('identical and empty', () => {
    assert({
      given: 'identical text, and text against nothing',
      should: 'keep everything, then delete everything',
      actual: [
        wordDiff('a b', 'a b').map((s) => s.kind),
        wordDiff('a b', '').map((s) => [s.kind, s.text]),
      ],
      expected: [['keep'], [['del', 'a b']]],
    });
  });
});

describe('diffCases', () => {
  test('no change', () => {
    const same = [sp('A', 'x', 'y')];
    assert({
      given: 'two identical snapshots',
      should: 'report nothing',
      actual: diffCases(same, same),
      expected: {
        counts: { add: 0, remove: 0, move: 0, edit: 0 },
        total: 0,
        groups: [],
      },
    });
  });

  test('added and removed', () => {
    const diff = diffCases([sp('A', 'x', 'y')], [sp('A', 'x', 'z')]);
    assert({
      given: 'y replaced by z',
      should: 'add z after X and remove y',
      actual: diff.groups[0]?.changes.map((c) => [c.op, c.title]),
      expected: [
        ['add', 'Z'],
        ['remove', 'Y'],
      ],
    });
  });

  test('one block moved, not both', () => {
    const diff = diffCases([sp('A', 'a', 'b')], [sp('A', 'b', 'a')]);
    assert({
      given: 'two blocks swapped',
      should: 'report the later one as moved, once, with where it was',
      actual: diff.groups[0]?.changes,
      expected: [
        {
          op: 'move',
          title: 'B moved',
          detail: 'Now first in the speech, was second',
        },
      ],
    });
  });

  test('a block moved to another speech', () => {
    const diff = diffCases(
      [sp('A', 'a'), sp('B', 'b')],
      [sp('A', 'a', 'b'), sp('B')],
    );
    assert({
      given: 'b moved from speech B to speech A',
      should: 'report it once, where it arrived',
      actual: [diff.counts, diff.groups.map((g) => g.speech)],
      expected: [{ add: 0, remove: 0, move: 1, edit: 0 }, ['A']],
    });
  });

  test('an edited claim', () => {
    const from = [{ ...sp('A'), blocks: [blk('x', 'one two')] }];
    const to = [{ ...sp('A'), blocks: [blk('x', 'one three')] }];
    assert({
      given: 'a block whose text changed',
      should: 'report an edit with the word segments',
      actual: diffCases(from, to).groups[0]?.changes[0],
      expected: {
        op: 'edit',
        title: 'X, claim',
        segments: [
          { kind: 'keep', text: 'one' },
          { kind: 'del', text: ' two' },
          { kind: 'ins', text: ' three' },
        ],
      },
    });
  });

  test('the sample case from v3 to the draft', () => {
    const c = getCase('aff-rights');
    if (c === undefined || c.draft === null) throw new Error('missing sample');
    const v3 = c.versions.find((v) => v.version === 3);
    const diff = diffCases(v3?.speeches ?? [], c.draft.speeches);
    assert({
      given: 'v3 and the working draft',
      should:
        'count 3 added, 1 removed, 1 moved and 1 edited across three speeches',
      actual: [diff.counts, diff.groups.map((g) => g.speech)],
      expected: [
        { add: 3, remove: 1, move: 1, edit: 1 },
        ['[Speech 1]', '[Speech 2]', '[Speech 3]'],
      ],
    });
  });
});
