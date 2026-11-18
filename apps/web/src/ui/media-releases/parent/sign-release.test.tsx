import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { SignRelease } from './sign-release';

setupRitewayBun();

test('SignRelease', () => {
  const action = async <S,>(previous: S) => previous;
  const html = renderToStaticMarkup(
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
  assert({
    given: 'an open request',
    should: 'ask about the minor by username',
    actual: html.includes('Let Daisy share @sam.rivera’s debate Rounds?'),
    expected: true,
  });
  assert({
    given: 'the draft wording',
    should: 'mark what counsel has not approved',
    actual: (html.match(/\[COUNSEL: /g) ?? []).length >= 4,
    expected: true,
  });
  assert({
    given: 'the paid-ads choice',
    should: 'be a separate box, off by default',
    actual: /name="paidAds"(?![^>]*checked)/.test(html),
    expected: true,
  });
  assert({
    given: 'the request facts',
    should: 'name the ladder and the dates, never an age',
    actual: [
      html.includes('Youth – Freestyle'),
      html.includes('29 Nov 2026'),
      /\b1[3-7]\b/.test(html.replace(/\d{1,2} Nov( \d{4})?/g, '')),
    ],
    expected: [true, true, false],
  });
  assert({
    given: 'the form',
    should: 'offer Sign release, Decline and This isn’t me',
    actual: ['Sign release', 'Decline', 'This isn’t me'].every((label) =>
      html.includes(label),
    ),
    expected: true,
  });
});
