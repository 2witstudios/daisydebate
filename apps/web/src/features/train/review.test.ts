import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sampleReviewCards } from '../../ui/mock/train-review';
import { sampleSummary } from '../../ui/mock/train';
import { getReviewQueue } from './get-review';
import { parseReviewQuery, reviewView } from './review';

setupRitewayBun();

const library = { total: 42, dueTomorrow: 2 };
const view = (params: Record<string, string> = {}) =>
  reviewView(sampleReviewCards, parseReviewQuery(params), library);

describe('parseReviewQuery', () => {
  test('defaults, values and bad values', () => {
    assert({
      given: 'nothing, a revealed third card after Good, and nonsense',
      should: 'start at card 1, read the values, and fall back',
      actual: [
        parseReviewQuery({}),
        parseReviewQuery({ card: '3', reveal: '1', last: 'good' }),
        parseReviewQuery({ card: 'x', last: 'meh', reveal: 'yes' }),
      ],
      expected: [
        { card: 1, reveal: false, last: null, plan: { mins: 20, did: [] } },
        { card: 3, reveal: true, last: 'good', plan: { mins: 20, did: [] } },
        { card: 1, reveal: false, last: null, plan: { mins: 20, did: [] } },
      ],
    });
  });
});

describe('getReviewQueue', () => {
  test('as many cards as are due', () => {
    assert({
      given: 'six due, then two due',
      should: 'return that many sample cards',
      actual: [
        getReviewQueue(sampleSummary).length,
        getReviewQueue({
          ...sampleSummary,
          saved: { ...sampleSummary.saved, due: 2 },
        }).length,
      ],
      expected: [6, 2],
    });
  });
});

describe('reviewView', () => {
  test('the first card, to recall', () => {
    const v = view();
    assert({
      given: 'the start of six due cards',
      should: 'show card 1 of 6 unrevealed with the queue and no last rating',
      actual:
        v.kind === 'card'
          ? [
              `${v.position} of ${v.count}`,
              v.progress,
              v.revealed,
              v.lastLine,
              v.queue.map((q) => q.state),
              v.left,
              v.revealHref,
            ]
          : null,
      expected: [
        '1 of 6',
        0,
        false,
        null,
        ['current', 'todo', 'todo', 'todo', 'todo', 'todo'],
        6,
        '/train/review?reveal=1',
      ],
    });
  });

  test('revealed: four ratings, each moving on', () => {
    const v = view({ card: '2', reveal: '1', last: 'hard' });
    assert({
      given: 'card 2 revealed after a Hard on card 1',
      should:
        'offer each rating as a link to card 3 with its choice, and say the last',
      actual:
        v.kind === 'card'
          ? [
              v.revealed,
              v.lastLine,
              v.rate.map((r) => [r.label, r.when, r.href]),
              v.queue.map((q) => q.state).slice(0, 3),
              v.left,
              v.progress,
            ]
          : null,
      expected: [
        true,
        'Hard: back in 2 days',
        [
          ['Again', '10 minutes', '/train/review?card=3&last=again'],
          ['Hard', '2 days', '/train/review?card=3&last=hard'],
          ['Good', '4 days', '/train/review?card=3&last=good'],
          ['Easy', '9 days', '/train/review?card=3&last=easy'],
        ],
        ['done', 'current', 'todo'],
        5,
        17,
      ],
    });
  });

  test('caught up after the last card', () => {
    const v = view({ card: '7', last: 'easy', did: 'impact-drill' });
    assert({
      given: 'a card past the last',
      should: 'be caught up, with tomorrow and a hub that counts review done',
      actual:
        v.kind === 'done'
          ? [
              v.reviewed,
              v.nextLine,
              v.backHref,
              v.queue.every((q) => q.state === 'done'),
              v.left,
            ]
          : null,
      expected: [
        6,
        'Next review: tomorrow, 2 arguments.',
        '/train/progress?did=review%2Cimpact-drill',
        true,
        0,
      ],
    });
  });

  test('nothing due but a library: caught up, reviewed none', () => {
    const v = reviewView([], parseReviewQuery({}), library);
    assert({
      given: 'no cards due today',
      should: 'be caught up with zero reviewed',
      actual: v.kind === 'done' ? v.reviewed : null,
      expected: 0,
    });
  });

  test('an empty library', () => {
    const v = reviewView([], parseReviewQuery({}), {
      total: 0,
      dueTomorrow: 0,
    });
    assert({
      given: 'no saved arguments at all',
      should: 'be the empty state with the way to a drill',
      actual: [v.kind, v.drillHref],
      expected: ['empty', '/train/drill?kind=impact'],
    });
  });

  test('plural tomorrow', () => {
    const v = reviewView(sampleReviewCards, parseReviewQuery({ card: '9' }), {
      total: 42,
      dueTomorrow: 1,
    });
    assert({
      given: 'one due tomorrow',
      should: 'say 1 argument',
      actual: v.kind === 'done' ? v.nextLine : null,
      expected: 'Next review: tomorrow, 1 argument.',
    });
  });

  test('the plan rides in links', () => {
    const v = view({ mins: '10', did: 'review', card: '2' });
    assert({
      given: 'a ten minute plan',
      should: 'keep it in the rating links and the edit link',
      actual: v.kind === 'card' ? [v.rate[2]?.href, v.editHref] : null,
      expected: [
        '/train/review?card=3&last=good&mins=10&did=review',
        '/train/drill?kind=impact&mins=10&did=review',
      ],
    });
  });
});
