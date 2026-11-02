import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { view } from '../../ui/debate-room/live-round.test-support';
import { RoundNativeAttendance } from './native-state';

setupRitewayBun();

const segmentId = 's4n6p8r2t4v6x8z1k3b5c7d9';
const state = {
  roundId: view.id,
  recorded: [{ segmentId, receivedAt: '2026-10-12T18:00:00.000Z' }],
  targets: [
    {
      segmentId,
      openedAt: '2026-10-12T18:00:00.000Z',
      effectiveDeadline: null,
      commandId: 'c4n6p8r2t4v6x8z1k3b5c7d9',
    },
  ],
};
const onlyInNoscript = (html: string) =>
  html.startsWith('<noscript>') && html.endsWith('</noscript>');

test('attendance text appears only without JavaScript', () => {
  const unavailable = renderToStaticMarkup(
    <RoundNativeAttendance view={view} state={null} />,
  );
  assert({
    given: 'an unavailable attendance read',
    should: 'keep its message out of a page that runs JavaScript',
    actual: [
      onlyInNoscript(unavailable),
      unavailable.includes('Attendance status is unavailable.'),
    ],
    expected: [true, true],
  });

  const available = renderToStaticMarkup(
    <RoundNativeAttendance view={view} state={state} />,
  );
  assert({
    given: 'recorded receipts and an open check-in target',
    should: 'keep the receipts and the form for a page without JavaScript',
    actual: [
      onlyInNoscript(available),
      available.includes('Attendance recorded for'),
      available.includes(`action="/api/rounds/${view.id}/check-in"`),
    ],
    expected: [true, true, true],
  });
});
