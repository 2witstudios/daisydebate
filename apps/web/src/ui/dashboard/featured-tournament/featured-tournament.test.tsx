import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { FeaturedTournament } from './featured-tournament';
import { tournament } from '../../mock/tournament';
import { createInitialState } from '../../store/state';
import { UiStoreProvider } from '../../store/store';
import { buttonClass } from '../../components/button/button-class';
import { stageColourClasses } from '../../test-support/stage-palette';

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

  test('sits on the competition tint with the page button', () => {
    const html = renderToString(
      h(UiStoreProvider, {
        initialState: createInitialState(),
        children: h(FeaturedTournament, {}),
      }),
    );
    assert({
      given: 'the featured tournament card on Home',
      should:
        'draw on the clay tint with page ink, the page primary button and no stage colour',
      actual: {
        clay: /<section class="[^"]*\bbg-hue-clay-soft\b[^"]*\btext-ink\b/.test(
          html,
        ),
        primary: html.includes(`class="${buttonClass('primary')}`),
        stage: stageColourClasses(html),
      },
      expected: { clay: true, primary: true, stage: [] },
    });
  });
});
