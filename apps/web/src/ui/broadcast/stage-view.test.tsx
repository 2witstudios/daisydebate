import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { StageView, type StageSnapshot } from './stage-view';

setupRitewayBun();

const seats: StageSnapshot['seats'] = [
  { side: 'affirmative', label: 'Ann', floor: true },
  { side: 'negative', label: 'Ned', floor: false },
];
const render = (snapshot: StageSnapshot) =>
  renderToStaticMarkup(
    <StageView
      snapshot={snapshot}
      nowMs={Date.parse('2026-11-02T00:00:00.000Z')}
      siteLink="daisydebate.com"
      tiles={<video data-tile="" />}
    />,
  );

test('a speech burns in clock, phase, names, floor, branding and link', () => {
  const html = render({
    phase: 'speech',
    clock: { label: 'Constructive', endsAt: '2026-11-02T00:01:05.000Z' },
    seats,
  });
  assert({
    given: 'an open speech',
    should: 'show each burned-in fact',
    actual: [
      'Constructive',
      '1:05',
      'Ann',
      'speaking',
      'Ned',
      'Daisy Debate',
      'daisydebate.com',
    ].filter((fact) => !html.includes(fact)),
    expected: [],
  });
});

test('a slate hides the tiles', () => {
  assert({
    given: 'prep',
    should: 'name the phase and hide the tiles, as appearance only',
    actual: [
      render({ phase: 'prep', clock: null, seats }).includes('Preparation'),
      render({ phase: 'prep', clock: null, seats }).includes(
        'visibility:hidden',
      ),
    ],
    expected: [true, true],
  });
});
