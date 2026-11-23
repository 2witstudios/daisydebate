import { instantMs } from '@daisy/clock';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  accessibleWithin,
  renderAccessible,
  type AccessibleView,
} from '../../test-support/rendered/accessible';
import type { SeatMedia } from './stage-subscriptions';
import type { StageSnapshot } from '../../features/stage-capture/stage-access';
import { StageView, type StageLink } from './stage-view';

setupRitewayBun();

const seats: StageSnapshot['seats'] = [
  {
    column: 'affirmative',
    columnLabel: 'Affirmative',
    label: 'Ann',
    kind: 'human',
    identity: 'aff',
    floor: true,
  },
  {
    column: 'negative',
    columnLabel: 'Negative',
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
const prep: StageSnapshot = {
  phase: 'prep',
  remainingMs: 90_000,
  seats,
};
const render = (
  snapshot: StageSnapshot,
  media: Readonly<Record<string, SeatMedia>> = {},
  link: StageLink = 'connected',
) =>
  renderAccessible(
    <StageView
      snapshot={snapshot}
      nowMs={instantMs('2026-11-02T00:00:00.000Z')}
      siteLink="daisydebate.com"
      link={link}
      mediaOf={(seat) => media[seat.label] ?? 'video'}
      tile={(seat) => <video data-tile={seat.label} />}
    />,
  );

/** The text of every element with this role, in order. */
const texts = (view: AccessibleView, role: string) =>
  view.all(role).map((element) => element.textContent);

/** Each seat: the tile it holds (by the test's own tile prop), its name, and where they sit. */
const seatsOf = (view: AccessibleView) =>
  view.all('listitem').map((seat) => {
    const name = accessibleWithin(seat).all('paragraph')[0] ?? null;
    const tile = seat.querySelector('video');
    return {
      tile: tile?.getAttribute('data-tile') ?? null,
      name: name?.textContent ?? null,
      tileBeforeName:
        tile !== null &&
        name !== null &&
        (tile.compareDocumentPosition(name) & 4) === 4,
      text: seat.textContent ?? '',
    };
  });

/** The first countdown on the frame: the speech clock or the slate's. */
const clockOf = (view: AccessibleView) =>
  view.all('strong')[0]?.textContent ?? null;

test('a speech burns in clock, phase, names, floor, branding and link', () => {
  const view = render(speech);
  assert({
    given: 'an open speech',
    should: 'show each burned-in fact',
    actual: {
      clock: view.within('banner').textContent(),
      countdown: clockOf(view),
      names: texts(view, 'paragraph'),
      floor: texts(view, 'emphasis'),
      brand: view.within('contentinfo').textContent(),
    },
    expected: {
      clock: 'Constructive1:05',
      countdown: '1:05',
      names: ['Ann', 'Ned'],
      floor: ['Speaking'],
      brand: 'Daisy Debatedaisydebate.com',
    },
  });
});

test('each tile sits with its own name, and no name sits on a tile', () => {
  assert({
    given: 'two debaters',
    should: 'put each tile and its name in one seat, the name after the tile',
    actual: seatsOf(render(speech)).map(
      (seat) => seat.tileBeforeName && seat.tile === seat.name,
    ),
    expected: [true, true],
  });
});

test('one camera off leaves the other debater over their own name', () => {
  const [ann, ned] = seatsOf(render(speech, { Ann: 'camera-off' }));
  assert({
    given: 'the first debater’s camera off',
    should: 'say so in their seat and keep the second tile in the second seat',
    actual: [ann?.text.includes('Camera off'), ann?.tile, ned?.tile],
    expected: [true, null, 'Ned'],
  });
});

test('a bot and an absent debater are named as what they are', () => {
  const [ann, ned] = seatsOf(
    render(speech, { Ann: 'voice-only', Ned: 'away' }),
  );
  assert({
    given: 'an AI debater, and a debater not connected',
    should: 'state each',
    actual: [
      ann?.text.includes('AI debater, voice only'),
      ned?.text.includes('Not connected'),
    ],
    expected: [true, true],
  });
});

test('a dropped room during a speech says so', () => {
  assert({
    given: 'a speech with the room held, then lost',
    should: 'state the gap only when it is one',
    actual: [
      render(speech).textContent().includes('Reconnecting'),
      render(speech, {}, 'reconnecting')
        .textContent()
        .includes('Reconnecting to the debate'),
      render(prep, {}, 'reconnecting').textContent().includes('Reconnecting'),
    ],
    expected: [false, true, false],
  });
});

test('a slate names the phase', () => {
  assert({
    given: 'prep',
    should: 'name the phase',
    actual: render(prep).has('heading', 'Preparation', { level: 1 }),
    expected: true,
  });
});

test('a slate counts down only to a deadline it has', () => {
  const between = {
    phase: 'between',
    remainingMs: 6_400,
    next: { label: 'Rebuttal' },
    seats,
  } as const;
  const slate = render({ phase: 'slate', seats });
  const ended = render({ phase: 'ended', seats });
  assert({
    given: 'prep, a countdown, a held start, judging and no round yet',
    should:
      'show the time left where there is a deadline, the next speech between speeches, and both sides on every slate',
    actual: [
      clockOf(render(prep)),
      clockOf(render(between)),
      texts(render(between), 'paragraph').includes('Next: Rebuttal'),
      clockOf(render({ ...between, remainingMs: null })),
      clockOf(render({ phase: 'judging', seats })),
      render({ phase: 'judging', seats }).has(
        'heading',
        'Judges are deciding',
        { level: 1 },
      ),
      clockOf(slate),
      slate.has('heading', 'Starting soon', { level: 1 }),
      ended.has('heading', 'This debate has ended', { level: 1 }),
      ended.textContent().includes('Starting soon'),
      [texts(slate, 'term'), texts(slate, 'definition')],
    ],
    expected: [
      '1:30',
      '0:07',
      true,
      null,
      null,
      true,
      null,
      true,
      true,
      false,
      [
        ['Affirmative', 'Negative'],
        ['Ann', 'Ned'],
      ],
    ],
  });
});
