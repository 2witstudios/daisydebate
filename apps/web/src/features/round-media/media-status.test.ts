import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { MediaAnswer } from './answer-watch';
import type { MediaConnectionState } from './media-controller';
import {
  mediaStatus,
  mediaWhile,
  retryMissingDevices,
  seatMicrophoneCaption,
  shownConnection,
  showConnection,
} from './media-status';

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

test('a released connection shows no last-known microphone state', () => {
  assert({
    given: 'the last server media state as the connection changes',
    should: 'keep it while the tracks are up, never after teardown',
    actual: (
      ['live', 'out-of-date', 'reconnecting', 'unavailable', 'ended'] as const
    ).map((connection) => mediaWhile(connection, 'open')),
    expected: ['open', 'open', null, null, null],
  });
});

test('a controller teardown clears the stage state it shows', () => {
  let connection = 'live';
  let media: string | null = 'open';
  const changed = showConnection<string>({
    connection: (state) => {
      connection = state;
    },
    media: (update) => {
      media = update(media);
    },
  });
  changed('live');
  const live = [connection, media];
  changed('unavailable');
  assert({
    given: 'the controller going live, then releasing as unavailable',
    should: 'keep the microphone state while live and clear it on teardown',
    actual: [live, [connection, media]],
    expected: [
      ['live', 'open'],
      ['unavailable', null],
    ],
  });
});

test('stale media state is never shown as plainly connected', () => {
  const status = mediaStatus('out-of-date', []);
  assert({
    given: 'live tracks whose reads keep stalling',
    should:
      'say the state may be out of date, without offering a teardown Retry',
    actual: [
      status.message === 'Connected',
      /out of date/.test(status.message),
      status.retry,
    ],
    expected: [false, true, false],
  });
});

test('a missing checked device stays named while status is out of date', () => {
  const status = mediaStatus('out-of-date', ['microphone']);
  assert({
    given: 'stalled reads and a checked microphone that went missing',
    should: 'name the device its Retry would forget',
    actual: [/microphone is missing/.test(status.message), status.retry],
    expected: [true, true],
  });
});

test('a seat caption claims a microphone state only from a current answer', () => {
  const caption = (
    peer: { readonly microphone: boolean } | undefined,
    answer: MediaAnswer,
    speaking = false,
    connection: MediaConnectionState = 'live',
  ) => seatMicrophoneCaption({ connection, peer, answer, speaking });
  assert({
    given: 'each answer state for a seat',
    should:
      'name open, closed or speaking only while the answer is current, say it is checking while superseded, and say out of date once stale or reads stop being answered',
    actual: [
      caption(undefined, 'current'),
      caption(undefined, 'stale'),
      caption({ microphone: false }, 'current'),
      caption({ microphone: true }, 'current'),
      caption({ microphone: true }, 'current', true),
      caption({ microphone: false }, 'checking'),
      caption({ microphone: true }, 'checking', true),
      caption({ microphone: true }, 'stale'),
      caption({ microphone: true }, 'stale', false, 'device-blocked'),
      caption({ microphone: true }, 'checking', false, 'out-of-date'),
      caption({ microphone: false }, 'current', false, 'out-of-date'),
    ],
    expected: [
      'Microphone unavailable',
      'Microphone unavailable',
      'Microphone closed',
      'Microphone open',
      'Speaking',
      'Checking microphone…',
      'Checking microphone…',
      'Microphone status out of date',
      'Microphone status out of date',
      'Microphone status out of date',
      'Microphone status out of date',
    ],
  });
});

test('a live connection with a stale answer shows as out of date', () => {
  assert({
    given: 'each connection beside a stale or current answer',
    should: 'turn only a live one with a stale answer to out of date',
    actual: [
      shownConnection('live', 'stale'),
      shownConnection('live', 'checking'),
      shownConnection('live', 'current'),
      shownConnection('device-blocked', 'stale'),
    ],
    expected: ['out-of-date', 'live', 'live', 'device-blocked'],
  });
});

test('out of date beside a missing device names both', () => {
  assert({
    given: 'reads unanswered and the checked camera gone',
    should: 'keep saying status may be out of date while naming the device',
    actual: mediaStatus('out-of-date', ['camera']).message.startsWith(
      'Connected, but camera and sound status may be out of date, and your checked camera is missing.',
    ),
    expected: true,
  });
});
