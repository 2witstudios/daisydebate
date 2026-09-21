import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { avatarClass } from './avatar-class';

setupRitewayBun();

const base =
  'relative inline-flex shrink-0 items-center justify-center rounded-round border border-border bg-surface-overlay font-bold text-ink-muted';

describe('avatarClass', () => {
  test('sizes the avatar', () => {
    assert({
      given: 'each size',
      should: 'add its own dimensions and type size to the base',
      actual: (['sm', 'md', 'lg'] as const).map(avatarClass),
      expected: [
        `${base} size-avatar-sm text-xs`,
        `${base} size-avatar-md text-sm`,
        `${base} size-avatar-lg text-md`,
      ],
    });
  });
});
