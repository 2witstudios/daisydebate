import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  classifySourceFailure,
  mediaStatus,
  type MicrophoneEvidence,
} from './media-status';

setupRitewayBun();

const cameraFailed: readonly (readonly [
  'camera',
  'permission' | 'absence' | 'failure',
])[] = [
  ['camera', classifySourceFailure(new DOMException('x', 'NotReadableError'))],
];

const evidence = (
  granted: boolean | null,
  published: boolean,
  muted = false,
): MicrophoneEvidence => ({ granted, published, muted });

const message = (microphone: MicrophoneEvidence | null) =>
  mediaStatus('live', [], [...cameraFailed], microphone).message;

test('a camera failure never claims a microphone it has no evidence for', () => {
  assert({
    given:
      'a camera that cannot start, against no microphone knowledge, no grant, and a grant without publication',
    should:
      'name only the camera loss, and say the microphone is not publishing only when the grant exists',
    actual: [
      message(null),
      message(evidence(false, false)),
      message(evidence(true, false)),
    ],
    expected: [
      'Connected Your camera could not start.',
      'Connected Your camera could not start.',
      'Connected Your camera could not start. Your microphone is not publishing.',
    ],
  });
});

test('a camera failure claims a live microphone only from a published track', () => {
  assert({
    given:
      'a published unmuted microphone, a deliberately muted one, and permission refusal instead of a device failure',
    should:
      'state the microphone as live or muted from its own evidence, and name a permission refusal as denied access',
    actual: [
      message(evidence(true, true)),
      message(evidence(true, true, true)),
      mediaStatus(
        'live',
        [],
        [
          [
            'camera',
            classifySourceFailure(new DOMException('x', 'NotAllowedError')),
          ],
        ],
      ).message,
    ],
    expected: [
      'Connected Your camera could not start. Your microphone stays live.',
      'Connected Your camera could not start. Your microphone is muted.',
      'Connected Your camera access is denied.',
    ],
  });
});

test('a microphone failure and a both-source failure each say only what happened', () => {
  assert({
    given:
      'a microphone that cannot start alone, and a camera and microphone failing together',
    should:
      'name the microphone alone, or both, without claiming anything else works',
    actual: [
      mediaStatus(
        'live',
        [],
        [
          [
            'microphone',
            classifySourceFailure(new DOMException('x', 'NotReadableError')),
          ],
        ],
      ).message,
      mediaStatus(
        'live',
        [],
        [
          ['camera', 'failure'],
          ['microphone', 'permission'],
        ],
      ).message,
    ],
    expected: [
      'Connected Your microphone could not start.',
      'Connected Your camera and microphone could not start.',
    ],
  });
});

test('a non-live connection states its own condition, never source health claims', () => {
  assert({
    given: 'the same camera failure while reconnecting, denied, and blocked',
    should:
      'carry only the connection condition, and keep manual Retry off a denied round',
    actual: [
      mediaStatus('reconnecting', [], [...cameraFailed]).message,
      mediaStatus('denied', [], [...cameraFailed]),
      mediaStatus('device-blocked', [], [...cameraFailed]).retry,
      mediaStatus('live', ['camera'], [...cameraFailed]).retry,
    ],
    expected: [
      'Reconnecting camera and sound…',
      {
        message:
          'Camera and sound were refused for this Round. A fresh admission is needed; refresh the page or leave and return once admitted.',
        retry: false,
      },
      true,
      true,
    ],
  });
});
