import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { view as round } from '../../ui/debate-room/live-round.test-support';
import { RoundNativeAttendance } from './native-state';

setupRitewayBun();

const view = { ...round, status: 'active' as const };

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
      unavailable.includes('http-equiv="refresh" content="5"'),
    ],
    expected: [true, true, true],
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
      available.includes('http-equiv="refresh"'),
    ],
    expected: [true, true, true, false],
  });
});

test('a Round that is not active offers no attendance at all', () => {
  assert({
    given: 'a scheduled Round, whose attendance read refuses',
    should: 'render no attendance text, form or refresh',
    actual: renderToStaticMarkup(
      <RoundNativeAttendance
        view={{ ...view, status: 'scheduled' }}
        state={null}
      />,
    ),
    expected: '',
  });
});
