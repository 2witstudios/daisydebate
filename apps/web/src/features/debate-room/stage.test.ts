import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { SpeechSlot } from './documents/documents';
import {
  floorStates,
  liveCaptions,
  speakerIsSelf,
  upNext,
  voiceBars,
} from './stage';
import type { TranscriptSegment } from './transcript';

setupRitewayBun();

const slot = (
  id: string,
  code: string,
  side: SpeechSlot['side'],
  durationMs: number,
): SpeechSlot => ({
  id,
  code,
  name: code,
  side,
  kind: 'speech',
  durationMs,
});

const speeches = [
  slot('ac', 'AC', 'aff', 300_000),
  slot('nc', 'NC', 'neg', 360_000),
  slot('1ar', '1AR', 'aff', 240_000),
  slot('2ar', '2AR', 'aff', 180_000),
];

describe('floorStates', () => {
  test('who holds the floor', () => {
    assert({
      given: 'cross-ex, the opponent’s speech, your own speech and judging',
      should: 'label each tile with its part in the phase',
      actual: [
        floorStates('cross-ex'),
        floorStates('opponent-speaking'),
        floorStates('own-speech'),
        floorStates('judging'),
      ],
      expected: [
        { self: 'Asking', opponent: 'Answering' },
        { self: '', opponent: 'Speaking' },
        { self: 'Speaking', opponent: '' },
        { self: '', opponent: '' },
      ],
    });
  });

  test('speakerIsSelf', () => {
    assert({
      given: 'your own speech and the opponent’s',
      should: 'make the speaker tile yours only in your own speech',
      actual: [speakerIsSelf('own-speech'), speakerIsSelf('opponent-speaking')],
      expected: [true, false],
    });
  });
});

describe('upNext', () => {
  test('the next two speeches', () => {
    assert({
      given: 'the round in its first speech',
      should: 'name the next two speeches with who gives them and their length',
      actual: upNext(speeches, 0, 'aff', 'Maya'),
      expected: [
        { label: 'Next', text: 'NC · Maya · 6:00' },
        { label: 'Then', text: '1AR · You · 4:00' },
      ],
    });
  });

  test('the end of the round', () => {
    assert({
      given: 'the round in its second-to-last speech',
      should: 'follow the last speech with judging',
      actual: upNext(speeches, 2, 'aff', 'Maya'),
      expected: [
        { label: 'Next', text: '2AR · You · 3:00' },
        { label: 'Then', text: 'Judging' },
      ],
    });
    assert({
      given: 'the round in its last speech',
      should: 'show judging alone',
      actual: upNext(speeches, 3, 'aff', 'Maya'),
      expected: [{ label: 'Next', text: 'Judging' }],
    });
  });
});

describe('voiceBars', () => {
  test('silence and full voice', () => {
    assert({
      given: 'silence',
      should: 'draw every bar at its lowest step',
      actual: voiceBars(0),
      expected: [1, 1, 1, 1, 1, 1, 1],
    });
    assert({
      given: 'full voice, and a reading above full',
      should: 'draw the meter’s shape at full height, never higher',
      actual: [voiceBars(1), voiceBars(4)],
      expected: [
        [3, 5, 4, 6, 3, 5, 2],
        [3, 5, 4, 6, 3, 5, 2],
      ],
    });
  });
});

describe('liveCaptions', () => {
  const segment = (
    id: string,
    speechId: string,
    offsetMs: number,
  ): TranscriptSegment => ({ id, speechId, offsetMs, text: id });
  const transcript = [
    segment('b', 'nc', 20_000),
    segment('a', 'nc', 10_000),
    segment('x', 'ac', 5_000),
    segment('c', 'nc', 30_000),
  ];

  test('the latest lines of the live speech', () => {
    assert({
      given: 'a live speech with three lines, out of order',
      should: 'keep its last two in order',
      actual: liveCaptions(transcript, 'nc').map((line) => line.id),
      expected: ['b', 'c'],
    });
    assert({
      given: 'no live speech',
      should: 'show no captions',
      actual: liveCaptions(transcript, null),
      expected: [],
    });
  });
});
