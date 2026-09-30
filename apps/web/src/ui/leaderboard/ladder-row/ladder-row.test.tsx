import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { LadderRow } from './ladder-row';
import { rowFixture } from './ladder-row.test-support';

setupRitewayBun();

const render = (props: Parameters<typeof rowFixture>[0], closed = false) =>
  renderToString(h(LadderRow, { row: rowFixture(props), closed }));

describe('LadderRow', () => {
  test('an established row is one link', () => {
    const html = render({ change: { kind: 'up', amount: 3 } });
    assert({
      given: 'an established debater',
      should:
        'be one link named with rank and rating, showing band, record and move',
      actual: [
        html.match(/<a /g)?.length,
        html.includes('aria-label="@ada, rank 4, rating 1650"'),
        html.includes('href="/leaderboard?debater=ada"'),
        html.includes('Full bloom'),
        html.includes('12–5'),
        html.includes('▲ 3'),
        html.includes('>You<'),
      ],
      expected: [1, true, true, true, true, true, false],
    });
  });

  test('the viewer’s own row', () => {
    const html = render({ me: true, selected: true });
    assert({
      given: 'the viewer’s row with its detail open',
      should: 'carry a You badge and mark the current link',
      actual: [
        html.includes('>You<'),
        html.includes('aria-current="true"'),
        html.includes('bg-surface-overlay'),
      ],
      expected: [true, true, true],
    });
  });

  test('provisional', () => {
    const html = render({
      provisional: true,
      rank: null,
      bloom: 'provisional',
      rating: 1412,
    });
    assert({
      given: 'a provisional debater',
      should:
        'show a dash for rank, a question mark on the rating and the hollow marker',
      actual: [
        html.includes('>–<'),
        html.includes('1412?'),
        html.includes('stroke-dasharray'),
        html.includes('Provisional'),
      ],
      expected: [true, true, true, true],
    });
  });

  test('a deleted account', () => {
    const html = render({ username: null, href: null });
    assert({
      given: 'a deleted account',
      should: 'show the tombstone name, keep the rating and not be a link',
      actual: [
        html.includes('[deleted debater]'),
        html.includes('1650'),
        html.includes('<a '),
      ],
      expected: [true, true, false],
    });
  });

  test('a debater the viewer is judging', () => {
    const html = render({
      masked: true,
      rank: null,
      rating: 0,
      bloom: 'provisional',
    });
    assert({
      given: 'a masked row',
      should: 'say Hidden and show no rating, record or hover card',
      actual: [
        html.includes('Hidden'),
        html.includes('>0<'),
        html.includes('12–5'),
        html.includes('Enter opens the full detail'),
      ],
      expected: [true, false, false, false],
    });
  });

  test('a closed season', () => {
    const html = render({ change: { kind: 'down', amount: 8 } }, true);
    assert({
      given: 'a closed season',
      should: 'show the signed season change',
      actual: html.includes('−8'),
      expected: true,
    });
  });

  test('hover card', () => {
    const html = render({});
    assert({
      given: 'a row with a username',
      should:
        'carry a hover card that reveals on hover and focus, hidden from assistive tech and on touch-width phones',
      actual: [
        html.includes('group-hover:visible'),
        html.includes('group-focus-within:visible'),
        html.includes('±120 · #4'),
        html.includes('aria-hidden="true"'),
      ],
      expected: [true, true, true, true],
    });
  });
});
