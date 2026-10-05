import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  destinations,
  destinationSlugs,
} from '../../../features/coming-soon/destinations';
import { notifyAction } from '../../../features/coming-soon/notify';
import { Explainer } from './explainer';
import { previewFor } from '../previews/preview-for';

setupRitewayBun();

const render = (slug: (typeof destinationSlugs)[number], signedIn = false) =>
  renderToString(
    h(Explainer, {
      destination: destinations[slug],
      notify: notifyAction(slug, signedIn),
      preview: previewFor(slug),
    }),
  );

describe('Explainer', () => {
  test('shows the whole explainer for every destination', () => {
    assert({
      given: 'each destination',
      should: 'render the badge, the tagline, the preview and both exits',
      actual: destinationSlugs.filter((slug) => {
        const html = render(slug);
        const copy = destinations[slug];
        return !(
          html.includes('Coming soon') &&
          html.includes(copy.tagline) &&
          html.includes('<figure') &&
          html.includes('Get notified') &&
          html.includes('Back to home')
        );
      }),
      expected: [],
    });
  });

  test('has one h1 outside the hidden preview', () => {
    const html = render('ranked');
    assert({
      given: 'an explainer',
      should: 'have exactly one h1, before the preview',
      actual: [
        html.match(/<h1[ >]/g)?.length,
        html.indexOf('<h1') < html.indexOf('<figure'),
      ],
      expected: [1, true],
    });
  });

  test('keeps the preview inert and hidden from assistive technology', () => {
    const html = render('lobby');
    const preview = html.slice(html.indexOf('<figure'));
    assert({
      given: 'the lobby explainer',
      should:
        'mark the preview frame inert and aria-hidden, containing sample buttons',
      actual: [
        /<div[^>]*inert=""[^>]*aria-hidden="true"|<div[^>]*aria-hidden="true"[^>]*inert=""/.test(
          preview,
        ),
        preview.includes('Find a match'),
      ],
      expected: [true, true],
    });
  });

  test('sends a visitor to sign in to get notified, and home', () => {
    const html = render('ranked');
    assert({
      given: 'a signed-out visitor',
      should: 'link Get notified to sign-in and Back to home to /',
      actual: [
        html.includes('href="/sign-in?next=%2Fcoming-soon%2Franked"'),
        html.includes('href="/"'),
        html.includes('disabled=""'),
      ],
      expected: [true, true, false],
    });
  });

  test('gives a signed-in member a working Get notified', () => {
    const html = render('ranked', true);
    assert({
      given: 'a signed-in member',
      should: 'answer Get notified on the same page, without a sign-in link',
      actual: [
        html.includes('href="?did=Get+notified"'),
        html.includes('disabled=""'),
        html.includes('not built yet'),
        html.includes('/sign-in'),
      ],
      expected: [true, false, false, false],
    });
  });
});
