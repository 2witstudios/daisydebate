import { instantMs } from '@daisy/clock';
import { createElement as h } from 'react';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { renderMarkup } from '../test-support/rendered/markup';
import { pageColourClasses } from '../ui/test-support/stage-palette';
import type { StageSnapshot } from '../features/stage-capture/stage-access';
import type { SeatMedia } from '../ui/broadcast/stage-subscriptions';
import { StageView, type StageLink } from '../ui/broadcast/stage-view';

setupRitewayBun();

/**
 * The stage is a video frame, not a page a reader moves through: a hidden
 * tile keeps its place under `invisible` (appearance only, so a camera is
 * attached when the next speech opens), and the frame's colours are stage
 * tokens (ADR 0045). Neither has an ARIA equivalent; the frame's facts are
 * read by role in ui/broadcast/stage-view.test.tsx.
 */
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
const prep: StageSnapshot = { phase: 'prep', remainingMs: 90_000, seats };
const render = (snapshot: StageSnapshot, link: StageLink = 'connected') =>
  renderMarkup(
    h(StageView, {
      snapshot,
      nowMs: instantMs('2026-11-02T00:00:00.000Z'),
      siteLink: 'daisydebate.com',
      link,
      mediaOf: (): SeatMedia => 'video',
      tile: (seat) => h('video', { 'data-tile': seat.label }),
    }),
  );

test('a gap or a slate hides the tiles, as appearance only', () => {
  assert({
    given: 'an open speech, a dropped speech and prep',
    should: 'hide the tiles only in the gap and on the slate',
    actual: [
      render(speech).includes('invisible'),
      render(speech, 'reconnecting').includes('invisible'),
      render(prep).includes('invisible'),
    ],
    expected: [false, true, true],
  });
});

test('the frame draws in the stage’s own colours', () => {
  assert({
    given: 'a speech and a slate',
    should: 'use no page colour, which would vanish on the frame',
    actual: [
      ...pageColourClasses(render(speech)),
      ...pageColourClasses(render(prep)),
    ],
    expected: [],
  });
});
