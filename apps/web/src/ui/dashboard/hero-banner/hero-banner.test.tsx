import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { HeroBanner } from './hero-banner';
import { art } from '../../assets';
import { initialLinkForm } from '../../auth/request-link';

setupRitewayBun();

const render = () =>
  renderToString(
    h(HeroBanner, { requestLink: () => Promise.resolve(initialLinkForm) }),
  );

describe('HeroBanner', () => {
  test('owns the page heading and describes its photograph', () => {
    const html = render();
    assert({
      given: 'the hero banner',
      should: 'render the headline as the h1 and the registered alt text',
      actual: [
        /<h1[^>]*>Debate is a sport now\.<\/h1>/.test(html),
        html.includes(`alt="${art.heroRidge.alt}"`),
      ],
      expected: [true, true],
    });
  });

  test('carries the owner copy', () => {
    const html = render();
    assert({
      given: 'the hero banner',
      should: 'show the eyebrow and the line exactly',
      actual: [
        html.includes('The #1 place to compete in debate online'),
        html.includes(
          'Live 1v1 rounds. Instant verdicts. Ratings on the line. A crowd watching.',
        ),
      ],
      expected: [true, true],
    });
  });

  test('joins with one email that posts without JavaScript', () => {
    const html = render();
    const form = /<form\b[^>]*>/.exec(html)?.[0] ?? '';
    assert({
      given: 'the hero banner rendered on the server',
      should:
        'offer one required email field in a form with no method or URL for the address, and link terms and privacy',
      actual: [
        /<input[^>]*name="email"[^>]*type="email"|<input[^>]*type="email"[^>]*name="email"/.test(
          html,
        ),
        /\brequired=""/.test(html),
        form.includes('method="get"'),
        html.includes('href="/terms"'),
        html.includes('href="/privacy"'),
      ],
      expected: [true, true, false, true, true],
    });
  });

  test('promises nothing unowned and no school framing', () => {
    const html = render();
    assert({
      given: 'the hero banner',
      should: 'leave out founding promises and school placeholders',
      actual: [/\.edu|school|founding|founders|apply early/i.test(html)],
      expected: [false],
    });
  });
});
