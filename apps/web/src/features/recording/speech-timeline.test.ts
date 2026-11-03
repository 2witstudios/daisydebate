import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { derivedMediaSource, speechTimeline } from './speech-timeline';

setupRitewayBun();

const capture = { startedAtMs: 1000, durationMs: 10_000, gaps: [] };

describe('speechTimeline', () => {
  test('places accepted floor turns in video time', () => {
    assert({
      given: 'turns before, across and after the capture',
      should: 'clip to the video and order by start',
      actual: speechTimeline(
        [
          { roundParticipantId: 'b', startedAtMs: 5000, endedAtMs: 7000 },
          { roundParticipantId: 'a', startedAtMs: 0, endedAtMs: 2000 },
          { roundParticipantId: 'x', startedAtMs: 0, endedAtMs: 500 },
          { roundParticipantId: 'c', startedAtMs: 10_000, endedAtMs: null },
        ],
        capture,
      ),
      expected: [
        { roundParticipantId: 'a', startMs: 0, endMs: 1000 },
        { roundParticipantId: 'b', startMs: 4000, endMs: 6000 },
        { roundParticipantId: 'c', startMs: 9000, endMs: 10_000 },
      ],
    });
  });
});

describe('speechTimeline across a capture gap', () => {
  const gapped = { ...capture, gaps: [{ startMs: 3000, endMs: 5000 }] };
  test('claims only what the video holds', () => {
    assert({
      given: 'a turn running through a gap',
      should: 'split around it',
      actual: speechTimeline(
        [{ roundParticipantId: 'a', startedAtMs: 2000, endedAtMs: 8000 }],
        gapped,
      ),
      expected: [
        { roundParticipantId: 'a', startMs: 1000, endMs: 3000 },
        { roundParticipantId: 'a', startMs: 5000, endMs: 7000 },
      ],
    });
    assert({
      given: 'a turn wholly inside a gap',
      should: 'offer no marker for it',
      actual: speechTimeline(
        [{ roundParticipantId: 'a', startedAtMs: 4200, endedAtMs: 5500 }],
        gapped,
      ),
      expected: [],
    });
  });
});

describe('derivedMediaSource', () => {
  const recording = { id: 'rec', roundId: 'round' };
  const media = {
    durationMs: 10_000,
    speeches: [
      { roundParticipantId: 'b', startMs: 0, endMs: 3000 },
      { roundParticipantId: 'a', startMs: 3000, endMs: 6000 },
      { roundParticipantId: 'b', startMs: 6000, endMs: 9000 },
    ],
  };

  test('records source, range and the people who appear', () => {
    assert({
      given: 'a range across two people',
      should: 'name the Recording, Round, range and each person once',
      actual: derivedMediaSource(recording, media, {
        startMs: 2000,
        endMs: 7000,
      }),
      expected: {
        recordingId: 'rec',
        roundId: 'round',
        startMs: 2000,
        endMs: 7000,
        roundParticipantIds: ['a', 'b'],
      },
    });
    assert({
      given: 'a range touching a turn only at its edge',
      should: 'not count that person',
      actual: derivedMediaSource(recording, media, {
        startMs: 3000,
        endMs: 6000,
      })?.roundParticipantIds,
      expected: ['a'],
    });
    assert({
      given: 'a range past the end of the video',
      should: 'be refused',
      actual: derivedMediaSource(recording, media, {
        startMs: 9000,
        endMs: 11_000,
      }),
      expected: null,
    });
  });
});
