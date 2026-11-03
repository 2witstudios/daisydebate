import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { ArchiveEntry } from '../../../features/recording/archive';
import { RecordingRow } from './recording-row';

setupRitewayBun();

const row: ArchiveEntry = {
  roundId: 'round',
  href: '/recordings/round',
  title: 'Semifinal',
  ranked: true,
  date: '2026-11-02',
  length: '30 min',
  aff: '@ada',
  neg: '@lin',
  result: 'Negative wins',
  media: 'watch',
  transcript: true,
  ownVisibility: null,
};
const render = (over: Partial<ArchiveEntry> = {}) =>
  renderToString(h(RecordingRow, { row: { ...row, ...over } }));

describe('RecordingRow', () => {
  test('a playable Recording', () => {
    const html = render();
    assert({
      given: 'a ready Recording',
      should: 'show its facts, result and one Replay link',
      actual: [
        'Semifinal',
        '@ada',
        '@lin',
        'Negative wins',
        'Replay Semifinal',
      ].map((text) => html.includes(text)),
      expected: [true, true, true, true, true],
    });
  });

  test('other states offer nothing fabricated', () => {
    const text = render({ media: 'not_recorded', length: null });
    assert({
      given: 'a transcript with no video',
      should: 'offer reading, not replay',
      actual: [
        text.includes('Not recorded'),
        text.includes('Read Semifinal'),
        text.includes('Replay'),
      ],
      expected: [true, true, false],
    });
    const held = render({ media: 'withheld', length: null });
    assert({
      given: 'video held back from this viewer, with a transcript',
      should: 'say so and offer reading, not replay',
      actual: [
        held.includes('Video being held back'),
        held.includes('Read Semifinal'),
        held.includes('Replay'),
      ],
      expected: [true, true, false],
    });
    assert({
      given: 'a permission that hides the result',
      should: 'show none',
      actual: render({ result: null }).includes('wins'),
      expected: false,
    });
    assert({
      given: 'the viewer own private Round',
      should: 'show its visibility',
      actual: render({ ownVisibility: 'private' }).includes('private'),
      expected: true,
    });
  });
});
