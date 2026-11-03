import { assert, setupRitewayBun, test } from 'riteway/bun';
import { seatMicrophoneCaption } from './seat-caption';
import { mediaStatus } from './media-state.test-support';

setupRitewayBun();

test('the media bar names a missing checked device and offers Retry while staying live', () => {
  const cases = [
    ['live with every device', mediaStatus('live', [])],
    ['live without the checked camera', mediaStatus('live', ['camera'])],
    [
      'live without both checked devices',
      mediaStatus('live', ['camera', 'microphone']),
    ],
    ['connecting', mediaStatus('connecting', [])],
    ['unavailable', mediaStatus('unavailable', [])],
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
      ['connecting', 'Connecting camera and sound…', false],
      [
        'unavailable',
        'Camera and sound are unavailable. Retry to reconnect.',
        true,
      ],
      ['an ended call', 'The call has ended.', false],
    ],
  });
});

test('stale media state is never shown as plainly connected', () => {
  const status = mediaStatus('out-of-date', []);
  assert({
    given: 'live tracks whose reads keep stalling',
    should:
      'say the state may be out of date, and offer Retry as the way out if it lasts',
    actual: [
      status.message === 'Connected',
      /out of date/.test(status.message),
      status.retry,
    ],
    expected: [false, true, true],
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

test('a seat caption claims a microphone state only from a track or a current answer', () => {
  const caption = (
    overrides: Partial<Parameters<typeof seatMicrophoneCaption>[0]>,
  ) =>
    seatMicrophoneCaption({
      connection: 'live',
      confirmed: true,
      track: undefined,
      mine: false,
      ownMuted: false,
      granted: true,
      remote: { microphonePublished: false },
      ...overrides,
    });
  const open = { muted: false, speaking: false };
  assert({
    given: 'each kind of evidence for a seat',
    should:
      'let a real track speak whatever the reads say, say it is checking while superseded, and say out of date once overdue',
    actual: [
      caption({ track: open, connection: 'out-of-date', confirmed: false }),
      caption({ track: { muted: false, speaking: true } }),
      caption({ track: { muted: true, speaking: false } }),
      caption({ granted: false }),
      caption({ granted: false, confirmed: false }),
      caption({ connection: 'out-of-date' }),
      caption({ connection: 'out-of-date', confirmed: false }),
      caption({ remote: undefined, confirmed: false }),
      caption({ remote: { microphonePublished: true } }),
    ],
    expected: [
      'Microphone open',
      'Speaking',
      'Microphone muted',
      'Microphone closed',
      'Checking microphone…',
      'Microphone status out of date',
      'Microphone status out of date',
      'Disconnected from media',
      'No microphone subscription',
    ],
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

test('an unavailable connection says what recovery will do, and refusal offers no Retry', () => {
  const status = (failure: 'transient' | 'definite' | 'refused') =>
    mediaStatus('unavailable', [], { failure });
  assert({
    given: 'each failure kind on a released connection',
    should:
      'not ask a person to act while it tries by itself, and never offer Retry after a refusal',
    actual: [status('transient'), status('definite'), status('refused')],
    expected: [
      {
        message: 'Camera and sound are unavailable. Trying again…',
        retry: true,
      },
      {
        message: 'Camera and sound are unavailable. Retry to reconnect.',
        retry: true,
      },
      {
        message:
          'Camera and sound were refused for this Round. A fresh admission is needed; refresh the page or leave and return once admitted.',
        retry: false,
      },
    ],
  });
});

test('a missing device offers Retry only while there is a connection to fix', () => {
  const retry = (connection: 'live' | 'ended', failure?: 'refused') =>
    mediaStatus(connection, ['camera'], failure ? { failure } : {}).retry;
  assert({
    given: 'a checked camera missing, then a refusal or the call ending',
    should: 'offer Retry on the live connection and never after those',
    actual: [
      retry('live'),
      retry('ended'),
      mediaStatus('unavailable', ['camera'], { failure: 'refused' }).retry,
    ],
    expected: [true, false, false],
  });
});
