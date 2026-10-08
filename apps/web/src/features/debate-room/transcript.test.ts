import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { SpeechSlot } from './documents/documents';
import {
  filterSections,
  formatOffset,
  groupTranscript,
  liveSegmentId,
  type TranscriptSegment,
} from './transcript';

setupRitewayBun();

const speech = (id: string, side: SpeechSlot['side']): SpeechSlot => ({
  id,
  code: id.toUpperCase(),
  side,
  kind: 'speech',
  durationMs: 300_000,
});
const speeches = [
  speech('ac', 'aff'),
  speech('nc', 'neg'),
  speech('1ar', 'aff'),
];
const segment = (
  id: string,
  speechId: string,
  offsetMs: number,
): TranscriptSegment => ({
  id,
  speechId,
  offsetMs,
  text: id,
});
const segments = [
  segment('n1', 'nc', 0),
  segment('a2', 'ac', 9_000),
  segment('a1', 'ac', 1_000),
];
const name = (slot: SpeechSlot) => (slot.side === 'aff' ? 'You' : 'Opponent');
const sections = groupTranscript(segments, speeches, name);

describe('groupTranscript', () => {
  test('grouping', () => {
    assert({
      given: 'segments for two of three speeches',
      should: 'return sections in speech order, dropping empty speeches',
      actual: sections.map((s) => [
        s.speech.id,
        s.speakerName,
        s.segments.map((x) => x.id),
      ]),
      expected: [
        ['ac', 'You', ['a1', 'a2']],
        ['nc', 'Opponent', ['n1']],
      ],
    });
  });
});

describe('filterSections', () => {
  test('filtering', () => {
    assert({
      given: 'all',
      should: 'keep every section',
      actual: filterSections(sections, 'all'),
      expected: sections,
    });
    assert({
      given: 'one speech id',
      should: 'keep only that section',
      actual: filterSections(sections, 'nc').map((s) => s.speech.id),
      expected: ['nc'],
    });
  });
});

describe('liveSegmentId', () => {
  test('live speech', () => {
    assert({
      given: 'a live speech with segments',
      should: 'return its last segment',
      actual: liveSegmentId(sections, 'ac'),
      expected: 'a2',
    });
    assert({
      given: 'no live speech',
      should: 'return null',
      actual: liveSegmentId(sections, null),
      expected: null,
    });
  });
});

describe('formatOffset', () => {
  test('formatting', () => {
    assert({
      given: 'an offset with a partial second',
      should: 'round down to m:ss',
      actual: formatOffset(65_900),
      expected: '1:05',
    });
    assert({
      given: 'a negative offset',
      should: 'clamp to 0:00',
      actual: formatOffset(-1),
      expected: '0:00',
    });
  });
});
