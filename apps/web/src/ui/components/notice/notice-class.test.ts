import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { noticeClass, noticeIconClass } from './notice-class';

setupRitewayBun();

describe('notice classes', () => {
  test('each tone', () => {
    assert({
      given: 'each tone',
      should: 'tint the callout and color its icon to match',
      actual: (['accent', 'gold', 'neutral'] as const).map((tone) => [
        noticeClass(tone),
        noticeIconClass(tone),
      ]),
      expected: [
        [
          'flex items-start gap-3 rounded-lg px-4 py-3 bg-accent-soft',
          'mt-1 text-accent',
        ],
        [
          'flex items-start gap-3 rounded-lg px-4 py-3 bg-gold-soft',
          'mt-1 text-gold',
        ],
        [
          'flex items-start gap-3 rounded-lg px-4 py-3 bg-surface-overlay',
          'mt-1 text-ink-muted',
        ],
      ],
    });
  });
});
