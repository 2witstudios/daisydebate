import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  ACTIVITY_RELAY_INTERVAL_MS,
  createActivityRelay,
} from '../apps/media-worker/src/capture-activity';
import type { StagedFrame } from '../apps/media-worker/src/capture-staging';
import { createBotActivityFeed } from '../apps/web/src/features/round-bots/activity-feed';
setupRitewayBun();
/**
 * Cross-app timing contract: the media worker's relay against the web bot's
 * activity feed. Continuous peer speech must never read as unknown.
 */
const roundId = 'a'.repeat(24),
  bot = 'b'.repeat(24),
  peer = 'c'.repeat(24),
  T0 = 2_000_000;
const iso = (ms: number) => new Date(T0 + ms).toISOString();
const staged = (sequence: number): StagedFrame => ({
  seat: peer,
  segmentId: 'g'.repeat(24),
  observedAtMs: sequence * 10 + 10,
  original: { sequence, beforeMs: sequence * 10, afterMs: sequence * 10 + 10 },
  frame: {
    pcm: new Int16Array(160).fill(16000),
    trackId: 'peer-track',
    nominalStartMs: T0 + sequence * 10,
    beforeMs: T0 + sequence * 10,
    afterMs: T0 + sequence * 10 + 10,
  },
});
test('continuous peer speech relayed by the worker reads as known activity', async () => {
  let now = 0,
    stored: Parameters<typeof JSON.stringify>[0] = null;
  const events: string[] = [];
  const feed = createBotActivityFeed({
    roundId,
    participantId: bot,
    peerParticipantIds: [peer],
    read: async () => stored as never,
    databaseNow: async () => iso(now),
    playing: () => true,
    onEvent: ({ kind }) => events.push(kind),
  });
  const relayer = createActivityRelay();
  const relay = () => {
    for (const batch of relayer.take())
      stored = {
        version: 1,
        roundId,
        roundParticipantId: batch.roundParticipantId,
        frames: batch.frames.map((f) => ({ ...f, receivedAt: iso(now) })),
      };
  };
  let polling = false;
  for (now = 0; now <= 3000; now += 5) {
    if (now > 0 && now % 10 === 0) relayer.observe(staged(now / 10 - 1));
    if (now % ACTIVITY_RELAY_INTERVAL_MS === 5) relay();
    if (stored && now % 50 === 30) polling = true;
    if (polling && now % 50 === 30) await feed.poll();
  }
  assert({
    given: 'three seconds of continuous 10 ms peer frames, polled every 50 ms',
    should: 'never report the speaking peer as unknown',
    actual: events.filter((kind) => kind === 'unknown').length,
    expected: 0,
  });
});
