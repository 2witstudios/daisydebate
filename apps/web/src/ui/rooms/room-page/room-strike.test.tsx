import { renderToStaticMarkup } from 'react-dom/server';
import type { RoomView } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assemblySnapshot } from '../../../features/rooms/assembly.test-support';
import { RoomStrike } from './room-strike';
import { RoomStrikeReveal } from './room-strike-reveal';

setupRitewayBun();

const SENTINEL = 'SENTINEL-CARD';
const host = 'o'.repeat(24);
const guest = 'g'.repeat(24);
const seat = (
  actorId: string,
  role: 'affirmative' | 'negative',
  label: string,
) => ({
  id: `${role[0]!.repeat(23)}1`,
  actorId,
  kind: 'human' as const,
  label,
  consentVersion: 1,
  role,
  slot: 0,
  needsReady: true,
  ready: 'ready' as const,
  eligible: true,
});
const base: RoomView = {
  ...assemblySnapshot,
  topic: null,
  config: {
    ...assemblySnapshot.config,
    resolutionDraw: {
      enabled: true,
      drawSize: 3,
      strikeWindowMs: 60_000,
      firstStriker: 'negative',
      source: { kind: 'host', count: 3 },
    },
  },
  participants: [
    seat(host, 'affirmative', 'Host'),
    seat(guest, 'negative', 'Jordan'),
  ],
};
const turn = {
  ordinal: 1,
  side: 'affirmative' as const,
  dueAt: '2026-10-12T00:01:00.000Z',
};
const debaterView: RoomView = {
  ...base,
  resolutionDraw: {
    visibility: 'debater',
    commitment: 'a'.repeat(64),
    drawSize: 3,
    items: [0, 1, 2].map((position) => ({
      position,
      text: `${SENTINEL} ${position}`,
      category: position === 0 ? 'value' : null,
    })),
    strikes: [{ ordinal: 0, side: 'negative', kind: 'timeout', position: 2 }],
    turn,
    revealedAt: null,
  },
  capabilities: { ...base.capabilities, canStrike: true },
};
const spectatorView: RoomView = {
  ...base,
  resolutionDraw: {
    visibility: 'progress',
    drawSize: 3,
    strikes: [{ ordinal: 0, side: 'negative', kind: 'timeout' }],
    turn,
    revealedAt: null,
  },
};
const render = (view: RoomView, actorId: string) =>
  renderToStaticMarkup(
    <RoomStrike
      view={view}
      actorId={actorId}
      now={Date.parse('2026-10-12T00:00:13.000Z')}
      action={async () => ({ values: {} })}
      strikeIds={['strike-0', 'strike-1']}
    />,
  );

test('the debater on turn gets a native strike form over the drawn cards', () => {
  const html = render(debaterView, host);
  assert({
    given: 'the Affirmative host on strike 2 of 2, 47 seconds left',
    should:
      'list every card, mark the time-out strike, post the ordinal with its own id and count down',
    actual: [
      html.includes(`${SENTINEL} 0`),
      html.includes('Daisy struck this for Jordan · time ran out'),
      html.includes('value="strike-resolution"'),
      html.includes('name="ordinal" value="1"'),
      html.includes('value="strike-1"'),
      html.includes('Strike this resolution'),
      html.includes('0:47'),
      html.includes('Value'),
    ],
    expected: [true, true, true, true, true, true, true, true],
  });
});

test('the opponent sees the cards but no strike button', () => {
  const html = render(
    { ...debaterView, capabilities: base.capabilities },
    guest,
  );
  assert({
    given: 'the Negative while the Affirmative strikes',
    should: 'say who is striking and offer no submit',
    actual: [
      html.includes('Host is striking'),
      html.includes('Strike this resolution'),
    ],
    expected: [true, false],
  });
});

test('a spectator sees progress and never a drawn text', () => {
  const html = render(spectatorView, 'w'.repeat(24));
  assert({
    given: 'a progress-only view',
    should: 'show the strike steps without any drawn resolution or form',
    actual: [
      html.includes('Hidden until the debaters finish striking'),
      html.includes('Strike 1'),
      html.includes(SENTINEL),
      html.includes('strike-resolution'),
    ],
    expected: [true, true, false, false],
  });
});

test('nothing renders before the draw or after the reveal', () => {
  assert({
    given: 'no draw, then a revealed draw',
    should: 'render nothing',
    actual: [
      render(base, host),
      render(
        {
          ...spectatorView,
          resolutionDraw: {
            ...spectatorView.resolutionDraw!,
            revealedAt: '2026-10-12T00:02:00.000Z',
          },
        },
        host,
      ),
    ],
    expected: ['', ''],
  });
});

const revealed = (view: RoomView): RoomView => ({
  ...view,
  topic: `${SENTINEL} 0`,
  resolutionDraw: view.resolutionDraw && {
    ...view.resolutionDraw,
    strikes: [
      ...view.resolutionDraw.strikes,
      ...(view.resolutionDraw.visibility === 'debater'
        ? [
            {
              ordinal: 1,
              side: 'affirmative' as const,
              kind: 'debater' as const,
              position: 1,
            },
          ]
        : [
            {
              ordinal: 1,
              side: 'affirmative' as const,
              kind: 'debater' as const,
            },
          ]),
    ],
    turn: null,
    revealedAt: '2026-10-12T00:00:40.000Z',
  },
});

test('after the reveal, debaters see how the resolution was chosen', () => {
  const debater = renderToStaticMarkup(
    <RoomStrikeReveal view={revealed(debaterView)} actorId={host} />,
  );
  const spectator = renderToStaticMarkup(
    <RoomStrikeReveal
      view={revealed(spectatorView)}
      actorId={'s'.repeat(24)}
    />,
  );
  assert({
    given: 'a revealed draw read by a debater and by a spectator',
    should:
      'show the debater the kept resolution’s category and every strike in order, and show the spectator nothing beyond the topic',
    actual: {
      heading: debater.includes('How it was chosen'),
      category: debater.includes('Value'),
      kept: debater.includes('Debated'),
      strikes: [
        debater.indexOf('Daisy struck this for Jordan · time ran out'),
        debater.indexOf('You struck this'),
      ].every((at) => at > -1),
      spectator,
      strikeFormGone: renderToStaticMarkup(
        <RoomStrike
          view={revealed(debaterView)}
          actorId={host}
          now={0}
          action={async () => ({ values: {} })}
          strikeIds={[]}
        />,
      ),
    },
    expected: {
      heading: true,
      category: true,
      kept: true,
      strikes: true,
      spectator: '',
      strikeFormGone: '',
    },
  });
});
