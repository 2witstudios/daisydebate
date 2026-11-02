import { renderToStaticMarkup } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RoundView } from '@daisy/protocol';
import { OpeningStatus, OpeningStrike } from './opening-strike';

setupRitewayBun();

const SENTINEL = 'A drawn resolution';
const dueAt = '2026-10-12T00:01:00.000Z';
const nowMs = Date.parse('2026-10-12T00:00:00.000Z');
const turn = { ordinal: 0, side: 'negative', dueAt, remainingMs: 60_000 } as const;
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
  ({ step: { step: 'strike' }, draw: debaterDraw, canStrike }) as const;
const view = {
  id: 'r'.repeat(24),
  version: 4,
  config: {
    resolutionDraw: { enabled: true, firstStriker: 'negative' },
  },
  participants: [
    { id: 'a'.repeat(24), actorId: 'aff', role: 'affirmative', label: 'Ana', kind: 'human', slot: 0 },
    { id: 'n'.repeat(24), actorId: 'neg', role: 'negative', label: 'Noor', kind: 'human', slot: 0 },
  ],
} as unknown as RoundView;
const render = (actorId: string, canStrike: boolean) =>
  renderToStaticMarkup(
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
    const html = render('neg', true);
    assert({
      given: 'the Negative on its turn, as a page without scripts renders it',
      should:
        'name its strike, count down from the due instant, and post the ordinal and seat',
      actual: [
        html.includes('Your strike'),
        html.includes('1:00'),
        html.includes('name="ordinal" value="0"'),
        html.includes(`name="participantId" value="${'n'.repeat(24)}"`),
        html.includes('name="type" value="strike_resolution"'),
        html.includes('Strike this resolution'),
      ],
      expected: [true, true, true, true, true, true],
    });
  });

  test('the other debater reads the same resolutions with nothing to press', () => {
    const html = render('aff', false);
    assert({
      given: 'the Affirmative during the Negative turn',
      should: 'name who is striking, show the texts and offer no submit',
      actual: [
        html.includes('Noor is striking'),
        html.includes(`${SENTINEL} 0`),
        html.includes('Strike this resolution'),
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
    const during = renderToStaticMarkup(
      <OpeningStatus
        view={
          {
            ...view,
            opening: { step: { step: 'strike' }, draw: progress, canStrike: false },
          } as RoundView
        }
        nowMs={nowMs}
      />,
    );
    const prep = renderToStaticMarkup(
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
            },
          } as RoundView
        }
        nowMs={nowMs}
      />,
    );
    assert({
      given: 'the strike, then prep',
      should: 'show progress with no drawn text, then the clock',
      actual: [
        during.includes('Strike 1'),
        during.includes(SENTINEL),
        prep.includes('1:00'),
      ],
      expected: [true, false, true],
    });
  });
});
