import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { SeatMedia } from './stage-subscriptions';
import { StageView, type StageLink, type StageSnapshot } from './stage-view';

setupRitewayBun();

const seats: StageSnapshot['seats'] = [
  {
    side: 'affirmative',
    label: 'Ann',
    kind: 'human',
    identity: 'aff',
    floor: true,
  },
  {
    side: 'negative',
    label: 'Ned',
    kind: 'human',
    identity: 'neg',
    floor: false,
  },
];
const speech: StageSnapshot = {
  phase: 'speech',
  clock: { label: 'Constructive', endsAt: '2026-11-02T00:01:05.000Z' },
  seats,
};
const render = (
  snapshot: StageSnapshot,
  media: Readonly<Record<string, SeatMedia>> = {},
  link: StageLink = 'connected',
) =>
  renderToStaticMarkup(
    <StageView
      snapshot={snapshot}
      nowMs={Date.parse('2026-11-02T00:00:00.000Z')}
      siteLink="daisydebate.com"
      link={link}
      mediaOf={(seat) => media[seat.label] ?? 'video'}
      tile={(seat) => <video data-tile={seat.label} />}
    />,
  );

test('a speech burns in clock, phase, names, floor, branding and link', () => {
  const html = render(speech);
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

test('each tile sits with its own name, and no name sits on a tile', () => {
  const html = render(speech);
  const seatsHtml = html.split('<li').slice(1);
  assert({
    given: 'two debaters',
    should: 'put each tile and its name in one seat, the name after the tile',
    actual: seatsHtml.map(
      (seat) =>
        seat.indexOf('data-tile="') < seat.indexOf('<p>') &&
        seat.includes(`data-tile="${/<p>(\w+)/.exec(seat)?.[1]}"`),
    ),
    expected: [true, true],
  });
});

test('one camera off leaves the other debater over their own name', () => {
  const html = render(speech, { Ann: 'camera-off' });
  assert({
    given: 'the first debater’s camera off',
    should: 'say so in their seat and keep the second tile in the second seat',
    actual: [
      html.split('<li')[1]?.includes('Camera off'),
      html.split('<li')[1]?.includes('data-tile'),
      html.split('<li')[2]?.includes('data-tile="Ned"'),
    ],
    expected: [true, false, true],
  });
});

test('a bot and an absent debater are named as what they are', () => {
  const html = render(speech, { Ann: 'voice-only', Ned: 'away' });
  assert({
    given: 'an AI debater, and a debater not connected',
    should: 'state each',
    actual: [
      html.includes('AI debater, voice only'),
      html.includes('Not connected'),
    ],
    expected: [true, true],
  });
});

test('a dropped room during a speech says so', () => {
  assert({
    given: 'a speech with the room held, then lost',
    should: 'state the gap only when it is one, and hide the tiles',
    actual: [
      render(speech).includes('Reconnecting'),
      render(speech, {}, 'reconnecting').includes('Reconnecting'),
      render(speech, {}, 'reconnecting').includes('invisible'),
      render({ ...speech, phase: 'prep' }, {}, 'reconnecting').includes(
        'Reconnecting',
      ),
    ],
    expected: [false, true, true, false],
  });
});

test('a slate hides the tiles', () => {
  const html = render({ phase: 'prep', clock: null, seats });
  assert({
    given: 'prep',
    should: 'name the phase and hide the tiles, as appearance only',
    actual: [html.includes('Preparation'), html.includes('invisible')],
    expected: [true, true],
  });
});
