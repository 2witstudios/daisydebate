import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sampleSummary } from '../../ui/mock/train';
import { modeCards } from './modes';
import { emptySummary } from './summary';

setupRitewayBun();

const statuses = (cards: ReturnType<typeof modeCards>) =>
  cards.map((card) => card.status);

describe('modeCards', () => {
  test('the first card is a voice debate against the AI', () => {
    const [first] = modeCards(sampleSummary, 'plan');
    assert({
      given: 'the train hub',
      should: 'offer a full AI debate by voice, opening the AI debate room',
      actual: { title: first?.title, href: first?.cta?.href },
      expected: { title: 'Debate the AI', href: '/ai-debate' },
    });
  });

  test('working the plan', () => {
    assert({
      given: 'an account with six arguments due',
      should: 'show times and the due count',
      actual: statuses(modeCards(sampleSummary, 'plan')),
      expected: ['About 45 min', '5 to 10 min', '6 due today'],
    });
  });

  test('plan done', () => {
    assert({
      given: 'a finished plan',
      should: 'say the review is caught up',
      actual: statuses(modeCards(sampleSummary, 'done'))[2],
      expected: 'All caught up',
    });
  });

  test('first visit', () => {
    const cards = modeCards(emptySummary, 'first');
    assert({
      given: 'an account that has saved nothing',
      should: 'point at drills and offer no review',
      actual: [statuses(cards), cards[2]?.cta],
      expected: [['About 45 min', 'Start here', 'Nothing saved yet'], null],
    });
  });

  test('nothing due', () => {
    assert({
      given: 'saved arguments but none due',
      should: 'say caught up',
      actual: statuses(
        modeCards(
          { ...sampleSummary, saved: { total: 42, due: 0, dueTomorrow: 2 } },
          'plan',
        ),
      )[2],
      expected: 'All caught up',
    });
  });
});
