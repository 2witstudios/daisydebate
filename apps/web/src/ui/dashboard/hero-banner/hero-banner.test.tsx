import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { HeroBanner } from './hero-banner';
import { art } from '../../assets';
import { initialLinkForm } from '../../auth/request-link';

setupRitewayBun();

const render = (showPricing = false) =>
  renderAccessible(
    h(HeroBanner, {
      requestLink: () => Promise.resolve(initialLinkForm),
      showPricing,
    }),
  );

/** Every link's destination, in document order. */
const hrefs = (view: ReturnType<typeof render>) =>
  view.all('link').map((link) => link.getAttribute('href'));

describe('HeroBanner', () => {
  test('links to /pricing only once it is open', () => {
    assert({
      given: 'the pricing page closed, then open',
      should: 'show the Plans and pricing link only when open',
      actual: [
        hrefs(render()).includes('/pricing'),
        render(true).attribute('link', 'Plans and pricing', 'href'),
      ],
      expected: [false, '/pricing'],
    });
  });

  test('owns the page heading and describes its photograph', () => {
    const view = render();
    assert({
      given: 'the hero banner',
      should: 'render the headline as the h1 and the registered alt text',
      actual: [
        view.names('heading', { level: 1 }),
        view.has('img', art.heroAgon.alt),
      ],
      expected: [['The arena for competitive debate'], true],
    });
  });

  test('carries the owner copy', () => {
    const text = render().textContent();
    assert({
      given: 'the hero banner',
      should:
        'show the landing mock line and the tagline, not staged-launch copy',
      actual: [
        text.includes('The #1 place'),
        text.includes('Better arguments. A more thoughtful world.'),
        text.includes('opening in stages'),
      ],
      expected: [false, true, false],
    });
  });

  test('joins with one email that posts before hydration', () => {
    const view = render();
    const email = view.get('textbox', 'Email');
    const form = email.closest('form');
    assert({
      given: 'the hero banner rendered on the server',
      should:
        'offer one required email field in a form with no method or URL for the address, and link terms and privacy',
      actual: [
        view.count('textbox'),
        [email.getAttribute('name'), email.getAttribute('type')],
        email.hasAttribute('required'),
        form?.getAttribute('method')?.toLowerCase() === 'get',
        view.attribute('link', 'Terms', 'href'),
        view.attribute('link', 'Privacy Policy', 'href'),
      ],
      expected: [1, ['email', 'email'], true, false, '/terms', '/privacy'],
    });
  });

  test('promises nothing unowned and no school framing', () => {
    const view = render();
    // What a visitor reads: the copy, every accessible name and the field's placeholder.
    const read = [
      view.textContent(),
      ...view.names('link'),
      ...view.names('img'),
      ...view.names('button'),
      view.attribute('textbox', 'Email', 'placeholder'),
    ].join(' ');
    assert({
      given: 'the hero banner',
      should: 'leave out founding promises and school placeholders',
      actual: [/\.edu|school|founding|founders|apply early/i.test(read)],
      expected: [false],
    });
  });

  test('leads to About Daisy under the join', () => {
    const view = render();
    const about = view.get('link', 'Learn about Daisy');
    const form = view.get('textbox', 'Email').closest('form');
    assert({
      given: 'the visitor hero',
      should: 'link Learn about Daisy to /about after the join form',
      actual: [
        about.getAttribute('href'),
        form !== null &&
          !form.contains(about) &&
          (form.compareDocumentPosition(about) &
            about.DOCUMENT_POSITION_FOLLOWING) !==
            0,
      ],
      expected: ['/about', true],
    });
  });
});
