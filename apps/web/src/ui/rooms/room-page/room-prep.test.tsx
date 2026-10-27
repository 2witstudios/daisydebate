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
