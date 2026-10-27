import { assert, setupRitewayBun, test } from 'riteway/bun';
import { mediaStatus, retryMissingDevices } from './media-status';

setupRitewayBun();

test('the media bar names a missing checked device and offers Retry while staying live', () => {
  const cases = [
    ['live with every device', mediaStatus('live', [])],
    ['live without the checked camera', mediaStatus('live', ['camera'])],
    [
      'live without both checked devices',
      mediaStatus('live', ['camera', 'microphone']),
    ],
    ['a missing device at capture', mediaStatus('device-missing', [])],
    ['connecting', mediaStatus('connecting', [])],
    ['unavailable', mediaStatus('unavailable', [])],
    ['blocked devices', mediaStatus('device-blocked', [])],
    ['an ended call', mediaStatus('ended', [])],
  ] as const;
  assert({
    given:
      'every connection state, and a live call with none, one or both checked devices gone',
    should:
      'name exactly the missing kinds in agreeing grammar, and offer Retry only when there is something to retry',
    actual: cases.map(([given, status]) => [
      given,
      status.message,
      status.retry,
    ]),
    expected: [
      ['live with every device', 'Connected', false],
      [
        'live without the checked camera',
        'Connected, but your checked camera is missing. Reconnect it, or retry to use your default.',
        true,
      ],
      [
        'live without both checked devices',
        'Connected, but your checked camera and microphone are missing. Reconnect them, or retry to use your default.',
        true,
      ],
      [
        'a missing device at capture',
        'Your checked camera or microphone is missing. Reconnect it, or retry to use your default device.',
        true,
      ],
      ['connecting', 'Connecting camera and sound…', false],
      [
        'unavailable',
        'Camera and sound are unavailable. Retry to reconnect.',
        true,
      ],
      [
        'blocked devices',
        'Camera or microphone access is blocked. Check your browser permissions, then retry.',
        true,
      ],
      ['an ended call', 'The call has ended.', false],
    ],
  });
});

test('Retry forgets only the checked devices found gone, then clears them', () => {
  const forgotten: unknown[] = [];
  const next = retryMissingDevices('room-a', ['camera'], (roomId, kinds) => {
    forgotten.push([roomId, kinds]);
  });
  assert({
    given: 'a Retry while only the checked camera is missing',
    should:
      'forget the camera choice alone for this Room and report nothing missing',
    actual: { forgotten, next },
    expected: { forgotten: [['room-a', ['camera']]], next: [] },
  });
});
