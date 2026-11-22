import { expect, test } from 'bun:test';
import { createAudienceStatePoll } from '../e2e/support/audience-state-standin';

test('the stand-in drains a slow publication after a sibling fails before polling again', async () => {
  const slow = Promise.withResolvers<null>();
  const rejected = Promise.withResolvers<null>();
  const failures: unknown[] = [];
  let scans = 0;
  const poll = createAudienceStatePoll({
    store: {
      readPublishing: async () => {
        scans += 1;
        if (scans > 1) return [];
        return ['slow', 'rejected'].map((id) => ({
          broadcastId: id,
          roundId: id,
          feedKey: id,
          linkHash: null,
          over: false,
        }));
      },
      readSpectatorTimeline: ({ roundId }) =>
        roundId === 'slow' ? slow.promise : rejected.promise,
      readAudienceSnapshot: async () => null,
    },
    feedOrigin: 'https://example.test',
    publish: () => {},
    withdraw: () => {},
    now: () => 0,
    report: (failure) => failures.push(failure),
  });

  const inFlight = poll();
  await poll();
  expect(scans).toBe(1);
  rejected.reject(new Error('Fixture exception details'));
  // Drain the rejection before simulating another interval tick.
  await new Promise<void>((resolve) => setImmediate(resolve));
  await poll();
  expect(scans).toBe(1);
  expect(failures).toEqual([]);

  slow.resolve(null);
  await inFlight;
  expect(failures).toEqual([
    { event: 'e2e.audience_state.publish_failed', failed: 1 },
  ]);
  await poll();
  expect(scans).toBe(2);
});
