import { assert, setupRitewayBun, test } from 'riteway/bun';
import { recordingLifecycleSchema } from './recording';

setupRitewayBun();

const at = '2026-11-02T10:00:00.000Z';
const capture = {
  egressId: 'EG_1',
  startedAt: at,
  endedAt: at,
  sourceKey: 'recordings/r/source.mp4',
};

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
      capture: { egressId: 'EG_1', startedAt: '2026-11-02T10:00:00+02:00' },
    }).success,
    expected: false,
  });
  assert({
    given: 'a requested Recording',
    should: 'parse',
    actual: recordingLifecycleSchema.parse({ status: 'requested' }).status,
    expected: 'requested',
  });
});
