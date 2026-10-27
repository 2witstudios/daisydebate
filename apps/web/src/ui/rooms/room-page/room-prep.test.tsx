import { renderToStaticMarkup } from 'react-dom/server';
import type { RoomView } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assemblySnapshot } from '../../../features/rooms/assembly.test-support';
import { destinationHref } from '../../../features/coming-soon/launch';
import { RoomPrep } from './room-prep';

setupRitewayBun();
const render = (view: RoomView) =>
  renderToStaticMarkup(
    <RoomPrep
      view={view}
      action={async () => ({ values: {} })}
      commandIds={{ start: 'start-id', finish: 'finish-id' }}
    />,
  );

test('preparation shows its saved length, then its live state', () => {
  const running = {
    ...assemblySnapshot,
    prep: {
      startedAt: '2026-10-12T00:00:00.000Z',
      remainingMs: 61000,
      finished: false,
    },
    capabilities: { ...assemblySnapshot.capabilities, canFinishPrep: true },
  };
  assert({
    given: 'saved 5:21 preparation not started, then running with 1:01 left',
    should: 'show the length, then the remaining time with the finish command',
    actual: [
      render(assemblySnapshot).includes('5:21 for both sides'),
      render(running).includes('1:01 left'),
      render(running).includes('value="finish-prep"'),
      render(running).includes('value="start-pre-round"'),
    ],
    expected: [true, true, true, false],
  });
});

test('the host starts preparation through a native versioned command', () => {
  const html = render({
    ...assemblySnapshot,
    capabilities: { ...assemblySnapshot.capabilities, canStartPreRound: true },
  });
  assert({
    given: 'a host permitted to start preparation',
    should: 'post start-pre-round with the room version and command identity',
    actual: [
      html.includes('value="start-pre-round"'),
      html.includes('name="expectedVersion" value="3"'),
      html.includes('value="start-id"'),
      html.includes(`href="${destinationHref('prep')}"`),
    ],
    expected: [true, true, true, true],
  });
});

test('a strike with no prep reads its own stage, then hands off to the start (PR #472 review)', () => {
  const strike = {
    ...assemblySnapshot,
    topic: null,
    config: {
      ...assemblySnapshot.config,
      preRoundPrep: { enabled: false as const },
      resolutionDraw: {
        enabled: true as const,
        drawSize: 3,
        strikeWindowMs: 60_000,
        firstStriker: 'negative' as const,
        source: { kind: 'bank' as const, categories: ['policy' as const] },
      },
    },
  };
  const draw = (revealedAt: string | null) => ({
    visibility: 'progress' as const,
    drawSize: 3,
    strikes: [],
    turn: null,
    revealedAt,
  });
  assert({
    given: 'a no-prep strike before its start, while striking, and revealed',
    should:
      'say what comes next at each stage, ending with the start of the round',
    actual: [
      render(strike).includes(
        'Once everyone is Ready, draw the resolutions and strike to one',
      ),
      render({ ...strike, resolutionDraw: draw(null) }).includes(
        'The debaters are striking',
      ),
      render({
        ...strike,
        topic: 'Chosen',
        resolutionDraw: draw('2026-10-12T00:01:00.000Z'),
      }).includes('Resolution chosen · start the round when the room is ready'),
    ],
    expected: [true, true, true],
  });
});
