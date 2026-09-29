import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { FeaturedTournament } from './featured-tournament';
import { tournament } from '../../mock/tournament';
import { createInitialState } from '../../store/state';
import { UiStoreProvider } from '../../store/store';
import { pageColourClasses } from '../../test-support/stage-palette';

setupRitewayBun();

describe('FeaturedTournament', () => {
  test('renders the event identity and entry point', () => {
    const html = renderToString(
      h(UiStoreProvider, {
        initialState: createInitialState(),
        children: h(FeaturedTournament, {}),
      }),
    );
    assert({
      given: 'the featured tournament card',
      should: 'carry the event name, a registration path, and the prize',
      actual: [
        html.includes(tournament.name),
        html.includes('href="/tournaments"'),
        html.includes('Register'),
        html.includes(tournament.prizePool),
      ],
      expected: [true, true, true, true],
    });
  });

  test('draws the stage card in the stage palette', () => {
    const html = renderToString(
      h(UiStoreProvider, {
        initialState: createInitialState(),
        children: h(FeaturedTournament, {}),
      }),
    );
    assert({
      given: 'the forest stage card',
      should: 'use no page-palette colour, which is forest on forest in light',
      actual: pageColourClasses(html),
      expected: [],
    });
  });
});
