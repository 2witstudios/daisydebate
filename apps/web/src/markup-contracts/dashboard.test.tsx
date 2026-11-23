import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderMarkup } from '../test-support/rendered/markup';
import { Dashboard } from '../ui/dashboard/dashboard';
import { HeroBanner } from '../ui/dashboard/hero-banner/hero-banner';
import { LiveNow } from '../ui/dashboard/live-now/live-now';
import { initialLinkForm } from '../ui/auth/request-link';
import { createInitialState } from '../ui/store/state';
import { UiStoreProvider } from '../ui/store/store';

setupRitewayBun();

const inStore = (children: ReturnType<typeof h>) =>
  renderMarkup(
    h(UiStoreProvider, { initialState: createInitialState(), children }),
  );

const renderWithGlance = (): string =>
  inStore(
    h(Dashboard, {
      audience: 'member',
      hero: null,
      liveNow: null,
      seasonGlance: { number: 7, line: '12 days left' },
    }),
  );

const render = (): string =>
  inStore(
    h(Dashboard, {
      audience: 'visitor',
      hero: h(HeroBanner, {
        requestLink: () => Promise.resolve(initialLinkForm),
      }),
      liveNow: h(LiveNow, { rounds: [] }),
    }),
  );

/**
 * What a phone shows is a responsive layout contract carried by classes
 * alone (`max-narrow:grid-cols-1`, `max-narrow:hidden`): the content is in
 * the tree at every width, so no role, name or state says which parts a
 * phone lays out or leaves off. The destinations, notes, outline and About
 * strip are asserted by role in ui/dashboard/dashboard.test.tsx.
 */
describe('Dashboard markup', () => {
  test('stacks the destinations in one column on a phone', () => {
    assert({
      given: 'the home dashboard',
      should: 'make the destinations a single column below the phone width',
      actual:
        /<ul class="[^"]*max-narrow:grid-cols-1[^"]*"[^>]*aria-label="Debate destinations"/.test(
          render(),
        ),
      expected: true,
    });
  });

  test('shows a visitor on a phone nothing but the way in', () => {
    const destinations = (html: string) =>
      /<ul class="[^"]*max-narrow:hidden[^"]*"[^>]*aria-label="Debate destinations"/.test(
        html,
      );
    assert({
      given: 'a visitor and a member',
      should: 'hide the menu from the visitor alone',
      actual: [destinations(render()), destinations(renderWithGlance())],
      expected: [true, false],
    });
  });

  test('leaves the lower cards off a phone for everyone', () => {
    const lowerCards = (html: string) =>
      /<div class="[^"]*grid-cols-dash-lower[^"]*max-narrow:hidden/.test(html);
    assert({
      given: 'a visitor and a member',
      should: 'hide the tournament and Live now cards from both',
      actual: [lowerCards(render()), lowerCards(renderWithGlance())],
      expected: [true, true],
    });
  });

  test('keeps the About strip off a phone like the cards above it', () => {
    const strip = (html: string) =>
      /<section[^>]*class="[^"]*max-narrow:hidden[^"]*"[^>]*>[\s\S]*?href="\/about"[\s\S]*?<\/section>/.test(
        html,
      );
    assert({
      given: 'a visitor and a member',
      should: 'leave the About strip off a phone',
      actual: [strip(renderWithGlance()), strip(render())],
      expected: [true, true],
    });
  });
});
