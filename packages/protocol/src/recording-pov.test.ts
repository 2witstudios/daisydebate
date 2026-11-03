import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  povCaptureId,
  povCaptureIdOfPath,
  povHoldPrefix,
  povObjectKey,
  recordingPovSchema,
} from './recording-pov';
import { recordingObjectPrefix } from './recording-lifecycle';

setupRitewayBun();

const SEAT = 'seatseatseatseatseatseat';
const REC = 'recrecrecrecrecrecrecrec';

describe('povCaptureIdOfPath', () => {
  test('names only a POV hold path', () => {
    assert({
      given: 'a POV segment path; a composite hold path; a stray path',
      should: 'name the capture, and nothing for the others',
      actual: [
        povCaptureIdOfPath(`${povHoldPrefix(REC, SEAT)}3/s`),
        povCaptureIdOfPath(`recording-hold/${REC}/3/s`),
        povCaptureIdOfPath('elsewhere/x/pov/y/1/s'),
      ],
      expected: [povCaptureId(REC, SEAT), null, null],
    });
  });
});

describe('povObjectKey', () => {
  test('keeps every file under the prefix removal lists', () => {
    assert({
      given: 'each file of a POV',
      should: 'sit under the Recording, named for its kind and not a person',
      actual: [
        povObjectKey(REC, SEAT, 'video'),
        povObjectKey(REC, SEAT, 'audio'),
      ].map((key) => [
        key.startsWith(recordingObjectPrefix(REC)),
        key.slice(key.lastIndexOf('/') + 1),
      ]),
      expected: [
        [true, 'video.mp4'],
        [true, 'audio.m4a'],
      ],
    });
  });
});

describe('recordingPovSchema', () => {
  const file = { key: 'recordings/r/pov/s/audio.m4a', byteSize: 1 };
  test('a missing POV carries no file, and a bot has no picture', () => {
    assert({
      given: 'a missing POV with a file; a built POV with voice alone',
      should: 'refuse the first and accept the second',
      actual: [
        recordingPovSchema.safeParse({
          status: 'missing',
          roundParticipantId: SEAT,
          reason: 'build_failed',
          audio: file,
        }).success,
        recordingPovSchema.safeParse({
          status: 'built',
          roundParticipantId: SEAT,
          video: null,
          audio: file,
          durationMs: 1000,
          gaps: [],
        }).success,
      ],
      expected: [false, true],
    });
  });
});
