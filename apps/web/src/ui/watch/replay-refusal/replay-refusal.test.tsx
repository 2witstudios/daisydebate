import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { watchViewer } from '../../../features/watch/debate-source';
import { openReplay } from '../../../features/watch/open-replay';
import { defaultReplayQuery } from '../../../features/watch/replay-query';
import { ReplayRefusal } from './replay-refusal';

setupRitewayBun();

const html = (id: string): string => {
  const screen = openReplay(id, watchViewer(true), defaultReplayQuery);
  if (screen.kind === 'watch') throw new Error('not a refusal');
  return renderToString(h(ReplayRefusal, { screen }));
};

describe('ReplayRefusal', () => {
  test('being prepared', () => {
    const page = html('just-finished');
    assert({
      given: 'a recording still processing',
      should: 'say it is being prepared and link back to the archive',
      actual: [
        page.includes('The replay is being prepared'),
        page.includes('Back to recordings'),
        page.includes('href="/recordings"'),
      ],
      expected: [true, true, true],
    });
  });

  test('past retention', () => {
    const page = html('older-round');
    assert({
      given: 'a recording past retention',
      should: 'say it is no longer kept',
      actual: [
        page.includes('This recording is no longer kept'),
        page.includes('Browse recordings'),
      ],
      expected: [true, true],
    });
  });

  test('private and missing are one answer', () => {
    assert({
      given: "someone else's private recording and an unknown id",
      should: 'render identical pages that do not say which',
      actual: [
        html('closed-door-recording') === html('nope'),
        html('nope').includes('This debate is not available'),
        html('nope').includes('Closed door'),
      ],
      expected: [true, true, false],
    });
  });
});
