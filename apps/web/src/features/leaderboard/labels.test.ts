import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  changeText,
  displayName,
  ratingText,
  rankText,
  recordText,
  rowLabel,
} from './labels';
import { rowFixture } from './ladder.test-support';

setupRitewayBun();

const row = rowFixture;

describe('changeText', () => {
  test('live and closed seasons', () => {
    const up = { kind: 'up', amount: 3 } as const;
    const down = { kind: 'down', amount: 5 } as const;
    const flat = { kind: 'flat', amount: 0 } as const;
    assert({
      given: 'each change in a live and a closed season',
      should: 'show arrows for the week and signed numbers for the season',
      actual: [
        [up, down, flat, { kind: 'none' } as const].map((c) =>
          changeText(c, false),
        ),
        [up, down, flat, { kind: 'none' } as const].map((c) =>
          changeText(c, true),
        ),
      ],
      expected: [
        ['▲ 3', '▼ 5', '–', '–'],
        ['+3', '−5', '0', '–'],
      ],
    });
  });
});

describe('row labels', () => {
  test('text parts', () => {
    assert({
      given: 'an established row and a deleted provisional row',
      should: 'format name, record, rating and rank',
      actual: [
        displayName(row()),
        displayName(row({ username: null })),
        recordText(row()),
        ratingText(row()),
        ratingText(row({ provisional: true })),
        rankText(row()),
        rankText(row({ rank: null })),
      ],
      expected: [
        '@ada',
        '[deleted debater]',
        '12–5',
        '1650',
        '1650?',
        '4',
        '–',
      ],
    });
  });

  test('masked', () => {
    const masked = row({ masked: true, rank: null });
    assert({
      given: 'a debater the viewer is judging',
      should: 'say Hidden for the rating and never give the number',
      actual: [ratingText(masked), rowLabel(masked)],
      expected: ['Hidden', '@ada, rating hidden while you judge'],
    });
  });

  test('accessible names', () => {
    assert({
      given: 'an established, a provisional and a deleted row',
      should: 'name who they are and where they stand',
      actual: [
        rowLabel(row()),
        rowLabel(row({ provisional: true, rank: null })),
        rowLabel(row({ username: null })),
      ],
      expected: [
        '@ada, rank 4, rating 1650',
        '@ada, provisional, rating 1650',
        'Deleted debater, rank 4, rating 1650',
      ],
    });
  });
});
