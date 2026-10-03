import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { modeCards } from '../../../features/train/modes';
import { emptySummary } from '../../../features/train/summary';
import { sampleSummary } from '../../mock/train';
import { ModeCards } from './mode-cards';

setupRitewayBun();

describe('ModeCards', () => {
  test('three modes with their links', () => {
    const html = renderToString(
      h(ModeCards, { cards: modeCards(sampleSummary, 'plan') }),
    );
    assert({
      given: 'the working-the-plan cards',
      should: 'link the AI debate, drills and review',
      actual: [
        html.includes('href="/ai-debate"'),
        html.includes('href="/train/drill"'),
        html.includes('href="/train/review"'),
        html.includes('6 due today'),
      ],
      expected: [true, true, true, true],
    });
  });

  test('no review link with nothing saved', () => {
    const html = renderToString(
      h(ModeCards, { cards: modeCards(emptySummary, 'first') }),
    );
    assert({
      given: 'the first-visit cards',
      should: 'show Nothing saved yet and no review link',
      actual: [
        html.includes('Nothing saved yet'),
        html.includes('href="/train/review"'),
      ],
      expected: [true, false],
    });
  });
});
