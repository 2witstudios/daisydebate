import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { watchViewer } from '../../../features/watch/debate-source';
import { listRecordings } from '../../../features/watch/list-recordings';
import { defaultRecordingsQuery } from '../../../features/watch/recordings-query';
import { RecordingRow } from './recording-row';

setupRitewayBun();

const row = (scope: 'all' | 'mine', index: number) => {
  const found = listRecordings(
    { ...defaultRecordingsQuery, scope },
    watchViewer(true),
  ).rows[index];
  if (!found) throw new Error('sample missing');
  return renderToString(h(RecordingRow, { row: found }));
};

describe('RecordingRow', () => {
  test('a public recording', () => {
    const html = row('all', 0);
    assert({
      given: 'the newest public recording',
      should: 'show title, facts, both players, the result and one Replay link',
      actual: [
        html.includes('Semifinal rehearsal'),
        html.includes('Standard rules · 30 min · Sep 29'),
        html.includes('@debater-g'),
        html.includes('Neg wins 2–1'),
        /<a [^>]*href="\/recordings\/semifinal-rehearsal"/.test(html),
        html.split('<a ').length - 1,
        html.includes('Private'),
      ],
      expected: [true, true, true, true, true, 1, false],
    });
  });

  test('my own recording carries visibility and retention', () => {
    const html = row('mine', 0);
    assert({
      given: 'my private practice',
      should: 'say You, Private and the keep line',
      actual: [
        html.includes('>You<'),
        html.includes('Private'),
        html.includes('Kept until [date]'),
      ],
      expected: [true, true, true],
    });
  });
});
