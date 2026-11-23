import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { Notice, noticeIcon } from './notice';
import { noticeClass, noticeIconClass } from './notice-class';
import { signInNotices } from '../sign-in-notices';

setupRitewayBun();

describe('Notice', () => {
  test('errors interrupt, information waits', () => {
    const error = renderAccessible(
      h(Notice, { id: 'n', tone: 'error', title: 'Refused.' }),
    );
    const errorRole = [error.has('alert'), error.text('alert')];
    const info = renderAccessible(
      h(Notice, { id: 'n', tone: 'info', title: 'Cancelled.' }),
    );
    assert({
      given: 'an error and an info notice',
      should:
        'use alert and status roles respectively (its decorative icon: see markup-contracts)',
      actual: [errorRole, [info.has('status'), info.has('alert')]],
      expected: [
        [true, 'Refused.'],
        [true, false],
      ],
    });
  });
});

describe('noticeClass', () => {
  test('tints errors with the live colour and information neutrally', () => {
    assert({
      given: 'each tone',
      should: 'pick the tone fill and icon colour',
      actual: [
        noticeClass('error').includes('bg-live-soft'),
        noticeClass('info').includes('bg-surface-overlay'),
        noticeIconClass('error').includes('text-live'),
        noticeIconClass('info').includes('text-ink-muted'),
        noticeIcon.error,
        noticeIcon.info,
      ],
      expected: [true, true, true, true, 'alert', 'clock'],
    });
  });
});

describe('signInNotices', () => {
  test('only failures are errors', () => {
    assert({
      given: 'every sign-in notice',
      should:
        'treat a cancelled or unsupported passkey as information, the rest as errors',
      actual: Object.entries(signInNotices)
        .filter(([, copy]) => copy.tone === 'info')
        .map(([notice]) => notice),
      expected: ['passkey-cancelled', 'passkey-unsupported'],
    });
  });
});
