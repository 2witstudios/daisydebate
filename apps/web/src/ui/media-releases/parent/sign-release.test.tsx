import { createElement as h } from 'react';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { SignRelease } from './sign-release';

setupRitewayBun();

test('SignRelease', () => {
  const action = async <S,>(previous: S) => previous;
  const view = renderAccessible(
    h(SignRelease, {
      minor: 'sam.rivera',
      requestedAt: '2026-11-15T12:00:00.000Z',
      expiresAt: '2026-11-29T12:00:00.000Z',
      sentTo: 'elena@example.com',
      sign: action,
      decline: action,
      notMe: action,
    }),
  );
  const text = view.textContent();
  const paidAds =
    /^Also allow clips of @sam\.rivera in Daisy’s paid advertising/;
  assert({
    given: 'an open request',
    should: 'ask about the minor by username',
    actual: view.has(
      'heading',
      'Let Daisy and others reuse @sam.rivera’s debate Rounds?',
      { level: 1 },
    ),
    expected: true,
  });
  assert({
    given: 'the draft wording',
    should: 'mark what counsel has not approved',
    actual: (text.match(/\[COUNSEL: /g) ?? []).length >= 4,
    expected: true,
  });
  assert({
    given: 'the paid-ads choice',
    should: 'be a separate box, off by default',
    actual: [
      view.attribute('checkbox', paidAds, 'name'),
      view.has('checkbox', paidAds, { checked: false }),
    ],
    expected: ['paidAds', true],
  });
  assert({
    given: 'the request facts',
    should: 'name the ladder and the dates, never an age',
    actual: [
      !text.includes('Youth – Freestyle'),
      text.includes('29 Nov 2026'),
      /\b1[3-7]\b/.test(text.replace(/\d{1,2} Nov( \d{4})?/g, '')),
    ],
    expected: [true, true, false],
  });
  assert({
    given: 'the form',
    should: 'offer Sign release, Decline and This isn’t me',
    actual: ['Sign release', 'Decline', 'This isn’t me'].map((label) =>
      view.count('button', label),
    ),
    // This isn’t me sits in the request facts and again on a phone.
    expected: [1, 1, 2],
  });
});
