import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createBotActivityFeed } from './activity-feed';
setupRitewayBun();
const roundId = 'a'.repeat(24),
  participantId = 'b'.repeat(24),
  peer = 'c'.repeat(24);
const at = (ms: number) => new Date(2000000 + ms).toISOString();
const frame = (sequence: number, level = 16000) => ({
  trackId: 'track',
  sequence,
  pcm: Array.from({ length: 160 }, () => level),
  beforeMs: sequence * 10,
  afterMs: sequence * 10 + 10,
  serverWindow: { before: at(sequence * 10), after: at(sequence * 10 + 10) },
  receivedAt: at(sequence * 10 + 20),
});
const batch = (frames: ReturnType<typeof frame>[]) => ({
  version: 1 as const,
  roundId,
  roundParticipantId: peer,
  frames,
});
function harness() {
  const events: string[] = [];
  let stored: ReturnType<typeof batch> | null = null,
    now = at(0),
    outage = false;
  const feed = createBotActivityFeed({
    roundId,
    participantId,
    peerParticipantIds: [peer],
    read: async (round, seat) => {
      if (outage) throw Error('redis unavailable');
      return round === roundId && seat === peer ? stored : null;
    },
    databaseNow: async () => now,
    playing: () => true,
    onEvent: ({ kind }) => events.push(kind),
  });
  return {
    feed,
    events,
    store: (value: ReturnType<typeof batch> | null) => {
      stored = value;
    },
    clock: (value: string) => {
      now = value;
    },
    fail: () => {
      outage = true;
    },
  };
}
test('repeated polls of one expiring batch deliver each frame once', async () => {
  const { feed, events, store, clock } = harness();
  const frames = Array.from({ length: 20 }, (_, i) => frame(i));
  store(batch(frames));
  clock(at(220));
  await feed.poll();
  await feed.poll();
  store(batch(Array.from({ length: 12 }, (_, i) => frame(20 + i))));
  clock(at(330));
  await feed.poll();
  assert({
    given: 'overlapping relay reads of contiguous peer frames during playback',
    should: 'emit only the retained barge-in heuristic once',
    actual: events,
    expected: ['barge-in'],
  });
});
test('stale, missing and unavailable activity is unknown', async () => {
  const { feed, events, store, clock, fail } = harness();
  store(batch([frame(0, 0)]));
  clock(at(400));
  await feed.poll();
  assert({
    given: 'a frame older than 250ms against fresh PG time',
    should: 'refuse it as unknown before delivery',
    actual: events,
    expected: ['unknown'],
  });
  store(null);
  await feed.poll();
  fail();
  await feed.poll();
  assert({
    given: 'a missing key and then a Redis outage',
    should: 'report unknown for each, never silence',
    actual: events,
    expected: ['unknown', 'unknown', 'unknown'],
  });
});
