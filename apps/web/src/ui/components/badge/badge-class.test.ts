import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { badgeClass } from './badge-class';

setupRitewayBun();

const base =
  'inline-flex items-center gap-1 rounded-badge px-badge-x py-badge-y text-badge leading-tight font-heavy tracking-wider whitespace-nowrap uppercase';

describe('badgeClass', () => {
  test('colors each tone', () => {
    assert({
      given: 'each tone',
      should: 'add its own fill and ink to the base',
      actual: (['neutral', 'live', 'gold', 'tier', 'accent'] as const).map(
        badgeClass,
      ),
      expected: [
        `${base} bg-surface-overlay text-ink-muted`,
        `${base} bg-live-soft text-live`,
        `${base} bg-transparent text-gold`,
        `${base} bg-transparent text-tier-diamond`,
        `${base} bg-accent-soft text-accent`,
      ],
    });
  });
});
