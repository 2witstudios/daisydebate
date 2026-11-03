import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  holdAttemptPrefix,
  recordingHoldPrefix,
  recordingLifecycleSchema,
} from './recording';

setupRitewayBun();

const at = '2026-11-02T10:00:00.000Z';
const attempt = { attempt: 1, egressId: 'EG_1', startedAt: at };
const source = { kind: 'broadcast_hold', broadcastId: 'b1' } as const;
const capture = { source, startedAt: at, attempts: [attempt], endedAt: at };

test('recordingLifecycleSchema', () => {
  assert({
    given: 'a ready Recording without media',
    should: 'not be representable',
    actual: recordingLifecycleSchema.safeParse({ status: 'ready', capture })
      .success,
    expected: false,
  });
  assert({
    given: 'a removed Recording still carrying media',
    should: 'not be representable',
    actual: recordingLifecycleSchema.safeParse({
      status: 'removed',
      cause: 'moderation',
      requestedAt: at,
      removedAt: at,
      media: {},
    }).success,
    expected: false,
  });
  assert({
    given: 'a capture with a local timestamp',
    should: 'refuse anything but UTC',
    actual: recordingLifecycleSchema.safeParse({
      status: 'capturing',
      capture: {
        source,
        startedAt: '2026-11-02T10:00:00+02:00',
        attempts: [attempt],
      },
    }).success,
    expected: false,
  });
  assert({
    given: 'a requested Recording',
    should: 'parse',
    actual: recordingLifecycleSchema.parse({ status: 'requested' }).status,
    expected: 'requested',
  });
  assert({
    given: 'capture with no attempt',
    should: 'not be representable',
    actual: recordingLifecycleSchema.safeParse({
      status: 'capturing',
      capture: { source, startedAt: at, attempts: [] },
    }).success,
    expected: false,
  });
  assert({
    given: 'a source named by a free path',
    should: 'not be representable',
    actual: recordingLifecycleSchema.safeParse({
      status: 'capturing',
      capture: {
        source: { kind: 'elsewhere/source.mp4' },
        startedAt: at,
        attempts: [attempt],
      },
    }).success,
    expected: false,
  });
});

test('recordingHoldPrefix', () => {
  assert({
    given: 'a Recording reading its Broadcast and one running its own Egress',
    should: 'point at the Broadcast hold and at its own, never each other',
    actual: [
      recordingHoldPrefix('r1', source),
      recordingHoldPrefix('r1', { kind: 'own_capture' }),
      holdAttemptPrefix(recordingHoldPrefix('r1', source), 2),
    ],
    expected: ['hold/b1/', 'recording-hold/r1/', 'hold/b1/2/'],
  });
});
