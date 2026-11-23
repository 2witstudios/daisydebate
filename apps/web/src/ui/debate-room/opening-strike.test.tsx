import { instantMs } from '@daisy/clock';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { twoSides } from '@daisy/protocol/seats';
import { type RoundView } from '@daisy/protocol/round-view';
import { renderAccessible } from '../../test-support/rendered/accessible';
import { OpeningChosen, OpeningStatus, OpeningStrike } from './opening-strike';
import { postedBy } from '../test-support/posted-fields.test-support';

setupRitewayBun();

const SENTINEL = 'A drawn resolution';
const dueAt = '2026-10-12T00:01:00.000Z';
const nowMs = instantMs('2026-10-12T00:00:00.000Z');
const turn = {
  ordinal: 0,
  side: 'negative',
  dueAt,
  remainingMs: 60_000,
} as const;
const debaterDraw = {
  visibility: 'debater',
  commitment: '0'.repeat(64),
  drawSize: 3,
  items: [0, 1, 2].map((position) => ({
    position,
    text: `${SENTINEL} ${position}`,
    category: null,
  })),
  strikes: [],
  turn,
  revealedAt: null,
} as const;
const opening = (canStrike: boolean) =>
  ({
    step: { step: 'strike' },
    draw: debaterDraw,
    canStrike,
    sides: null,
  }) as const;
const view = {
  id: 'r'.repeat(24),
  version: 4,
  config: {
    resolutionDraw: { enabled: true, firstStriker: 'negative' },
  },
  rules: { sides: twoSides },
  participants: [
    {
      id: 'a'.repeat(24),
      actorId: 'aff',
      seat: { kind: 'side', side: 'affirmative', slot: 0 },
      label: 'Ana',
      kind: 'human',
    },
    {
      id: 'n'.repeat(24),
      actorId: 'neg',
      seat: { kind: 'side', side: 'negative', slot: 0 },
      label: 'Noor',
      kind: 'human',
    },
  ],
} as unknown as RoundView;
const render = (actorId: string, canStrike: boolean) =>
  renderAccessible(
    <OpeningStrike
      view={view}
      opening={opening(canStrike)}
      draw={debaterDraw}
      actorId={actorId}
      nowMs={nowMs}
      commandId="c"
      post={() => undefined}
      pending={false}
    />,
  );

describe('OpeningStrike', () => {
  test('the striker gets one native form with the turn it means to take', () => {
    const view = render('neg', true);
    const posted = postedBy(view, 'Strike this resolution');
    assert({
      given: 'the Negative on its turn, as the server renders it',
      should:
        'name its strike, count down from the due instant, and post the ordinal and seat',
      actual: [
        view.has('heading', 'Your strike', { level: 1 }),
        view.text('timer', 'Time left for this strike'),
        posted.ordinal,
        posted.participantId,
        posted.type,
      ],
      expected: [
        true,
        'Your time1:00',
        '0',
        'n'.repeat(24),
        'strike_resolution',
      ],
    });
  });

  test('the other debater reads the same resolutions with nothing to press', () => {
    const view = render('aff', false);
    assert({
      given: 'the Affirmative during the Negative turn',
      should: 'name who is striking, show the texts and offer no submit',
      actual: [
        view.has('heading', 'Noor is striking', { level: 1 }),
        view.textContent().includes(`${SENTINEL} 0`),
        view.textContent().includes('Strike this resolution') ||
          view.has('button', 'Strike this resolution'),
      ],
      expected: [true, true, false],
    });
  });
});

describe('OpeningStatus', () => {
  const progress = {
    visibility: 'progress',
    drawSize: 3,
    strikes: [],
    turn,
    revealedAt: null,
  } as const;

  test('a judge or spectator reads progress, then the prep clock', () => {
    const during = renderAccessible(
      <OpeningStatus
        view={
          {
            ...view,
            opening: {
              step: { step: 'strike' },
              draw: progress,
              canStrike: false,
              sides: null,
            },
          } as RoundView
        }
        nowMs={nowMs}
      />,
    ).textContent();
    const prep = renderAccessible(
      <OpeningStatus
        view={
          {
            ...view,
            opening: {
              step: {
                step: 'prep',
                startedAt: '2026-10-12T00:00:00.000Z',
                endsAt: dueAt,
                remainingMs: 60_000,
              },
              draw: progress,
              canStrike: false,
              sides: null,
            },
          } as RoundView
        }
        nowMs={nowMs}
      />,
    ).text('timer', 'Prep before the round');
    assert({
      given: 'the strike, then prep',
      should: 'show progress with no drawn text, then the clock',
      actual: [during.includes('Strike 1'), during.includes(SENTINEL), prep],
      expected: [true, false, 'Prep · 1:00'],
    });
  });
});

describe('OpeningChosen', () => {
  const revealed = {
    ...debaterDraw,
    strikes: [
      {
        ordinal: 0,
        side: 'negative',
        kind: 'debater',
        position: 0,
        byViewer: false,
      },
      {
        ordinal: 1,
        side: 'affirmative',
        kind: 'timeout',
        position: 1,
        byViewer: false,
      },
    ],
    turn: null,
    revealedAt: dueAt,
  } as const;

  test('debaters read how the resolution was chosen, with each strike in order', () => {
    const chosen = renderAccessible(
      <OpeningChosen view={view} draw={revealed} actorId="aff" />,
    );
    const lines = chosen
      .within('group')
      .all('listitem')
      .map((line) => line.textContent ?? '');
    assert({
      given: 'a revealed draw read by a debater',
      should: 'list both struck lines, then the one debated',
      actual: [
        chosen.textContent().startsWith('How it was chosen'),
        lines.map((line) => line.slice(0, `${SENTINEL} 0`.length)),
        lines.at(-1)?.endsWith('Debated'),
      ],
      expected: [
        true,
        [`${SENTINEL} 0`, `${SENTINEL} 1`, `${SENTINEL} 2`],
        true,
      ],
    });
  });

  test('nothing renders before the reveal, or for anyone else', () => {
    const progress = {
      visibility: 'progress',
      drawSize: 3,
      strikes: [],
      turn: null,
      revealedAt: dueAt,
    } as const;
    assert({
      given: 'an unrevealed draw, and a revealed one read as progress',
      should: 'render nothing',
      actual: [
        renderAccessible(
          <OpeningChosen view={view} draw={debaterDraw} actorId="aff" />,
        ).textContent(),
        renderAccessible(
          <OpeningChosen view={view} draw={progress} actorId="aff" />,
        ).textContent(),
      ],
      expected: ['', ''],
    });
  });
});
