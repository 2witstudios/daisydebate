import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { ArchiveEntry } from '../../../features/recording/archive';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { RecordingRow } from './recording-row';

setupRitewayBun();

const row: ArchiveEntry = {
  roundId: 'round',
  href: '/recordings/round',
  title: 'Semifinal',
  ranked: true,
  date: '2026-11-02',
  length: '30 min',
  seats: ['@ada', '@lin'],
  result: 'Negative wins',
  media: 'watch',
  transcript: true,
  ownVisibility: null,
};
const render = (over: Partial<ArchiveEntry> = {}) =>
  renderAccessible(h(RecordingRow, { row: { ...row, ...over } }));

describe('RecordingRow', () => {
  test('a playable Recording', () => {
    const view = render();
    const text = view.textContent();
    assert({
      given: 'a ready Recording',
      should: 'show its facts, result and one Replay link',
      actual: [
        ...['Semifinal', '@ada', '@lin', 'Negative wins'].map((fact) =>
          text.includes(fact),
        ),
        view.names('link'),
        view.attribute('link', 'Replay Semifinal', 'href'),
      ],
      expected: [
        true,
        true,
        true,
        true,
        ['Replay Semifinal'],
        '/recordings/round',
      ],
    });
  });

  test('other states offer nothing fabricated', () => {
    const view = render({ media: 'not_recorded', length: null });
    assert({
      given: 'a transcript with no video',
      should: 'offer reading, not replay',
      actual: [
        view.textContent().includes('Not recorded'),
        view.names('link'),
        view.textContent().includes('Replay'),
      ],
      expected: [true, ['Read Semifinal'], false],
    });
    const held = render({ media: 'withheld', length: null });
    assert({
      given: 'video held back from this viewer, with a transcript',
      should: 'say so and offer reading, not replay',
      actual: [
        held.textContent().includes('Video being held back'),
        held.names('link'),
        held.textContent().includes('Replay'),
      ],
      expected: [true, ['Read Semifinal'], false],
    });
    assert({
      given: 'a permission that hides the result',
      should: 'show none',
      actual: render({ result: null }).textContent().includes('wins'),
      expected: false,
    });
    assert({
      given: 'the viewer own private Round',
      should: 'show its visibility',
      actual: render({ ownVisibility: 'private' })
        .textContent()
        .includes('private'),
      expected: true,
    });
  });
});
