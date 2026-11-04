import {
  VIEWER_BUCKET_MS,
  audienceStateSchema,
  type AudienceState,
  viewersFromSample,
} from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  createAudienceStatePublisher,
  type AudienceStateFailure,
} from './audience-state';

setupRitewayBun();

const NOW = VIEWER_BUCKET_MS * 1000;
const roundId = 'abcdefghijklmnopqrstuvwx';
const broadcastId = 'b'.repeat(24);
const started = new Date(NOW - 300_000);

const timelineRead = {
  round: {
    id: roundId,
    roomId: 'room',
    visibility: 'public',
    status: 'active',
    competitionType: 'ranked' as const,
    resolution: 'A resolution',
    rules: { segments: [] },
    outcome: null,
    startedAt: started,
    completedAt: null,
  },
  broadcast: {
    id: broadcastId,
    feedKey: 'feed',
    deliveryPath: 'owned_hls',
    policy: { kind: 'delay', seconds: 60 },
    releasedThroughAt: new Date(NOW - 60_000),
    completedAt: null,
    stoppedAt: null,
    mediaWithheld: false,
  },
  recordingStatus: null,
  recordingLifecycle: null,
  recordingJob: null,
  seats: [],
  horizonMs: NOW - 60_000,
  segments: [],
  ballots: [],
  ratings: [],
  captions: [],
  outcomeReleased: false,
};

const harness = (over: {
  readonly publishing?: readonly Record<string, unknown>[];
  readonly count?: () => Promise<number>;
  readonly read?: () => Promise<unknown>;
  readonly put?: (key: string) => Promise<void>;
  readonly now?: () => number;
  readonly published?: string;
}) => {
  const puts: { key: string; body: string; headers: unknown }[] = [];
  const deletes: string[] = [];
  const withdrawn: string[] = [];
  const failures: AudienceStateFailure[] = [];
  let publishing = over.publishing ?? [
    { broadcastId, roundId, feedKey: 'feed', linkHash: null, over: false },
  ];
  const publisher = createAudienceStatePublisher({
    store: {
      readPublishing: async () => publishing as never,
      readSpectatorTimeline: (async () =>
        over.read ? over.read() : timelineRead) as never,
      readAudienceSnapshot: (async () => ({
        visibility: 'public',
        hasBroadcast: true,
        open: true,
        messages: [],
        reactions: [],
      })) as never,
      recordStateWithdrawn: async (input) => {
        withdrawn.push(input.broadcastId);
      },
    },
    objects: {
      putState: async (key, body, headers) => {
        await over.put?.(key);
        puts.push({ key, body, headers });
      },
      readState: async () => over.published ?? null,
      deletePublic: async (key) => {
        deletes.push(key);
      },
    },
    counts: { readViewerCount: over.count ?? (async () => 40) },
    keyOf: (feed, link) => `${feed}-${link ?? 'public'}`,
    feedUrlOf: (feed) => `https://feed.invalid/live/${feed}/master.m3u8`,
    now: over.now ?? (() => NOW),
    report: (failure) => failures.push(failure),
  });
  return {
    publisher,
    puts,
    deletes,
    withdrawn,
    failures,
    setPublishing: (next: readonly Record<string, unknown>[]) => {
      publishing = next;
    },
  };
};
const firstState = async () => {
  const h = harness({});
  await h.publisher.pass();
  return h.puts.at(-1)!.body;
};

const stateOf = (body: string): AudienceState =>
  audienceStateSchema.parse(JSON.parse(body));

test('a pass publishes the state a player can read, uncached', async () => {
  const h = harness({});
  await h.publisher.pass();
  const state = stateOf(h.puts[0]!.body);
  assert({
    given: 'one open Broadcast',
    should: 'write its state under its key, no-cache, stamped now',
    actual: [
      h.puts[0]!.key,
      h.puts[0]!.headers,
      state.publishedAtMs,
      state.timeline.roundId,
      state.audience.viewers,
      state.pulseRate,
    ],
    expected: [
      'state/feed-public.json',
      { 'cache-control': 'no-cache', 'content-type': 'application/json' },
      NOW,
      roundId,
      40,
      1,
    ],
  });
});

test('the sampling follows the audience and the count stays honest', async () => {
  let count = 5000;
  let nowMs = NOW;
  const h = harness({ count: async () => count, now: () => nowMs });
  await h.publisher.pass();
  await h.publisher.pass();
  nowMs += VIEWER_BUCKET_MS;
  count = 500;
  await h.publisher.pass();
  const [first, again, next] = h.puts.map((put) => stateOf(put.body));
  assert({
    given:
      'an audience above what every tab may pulse for, sampled from then on',
    should:
      'publish a lower rate, hold it through the bucket, and scale by the rate in force while the count gathered',
    actual: [
      [first!.audience.viewers, first!.pulseRate],
      [again!.audience.viewers, again!.pulseRate],
      [next!.audience.viewers, next!.pulseRate],
    ],
    expected: [
      [5000, 0.1],
      [5000, 0.1],
      [5000, 0.1],
    ],
  });
});

test('a lost count takes nothing else with it', async () => {
  const h = harness({ count: () => Promise.reject(new Error('down')) });
  await h.publisher.pass();
  assert({
    given: 'Redis down',
    should: 'publish the state with no count',
    actual: stateOf(h.puts[0]!.body).audience.viewers,
    expected: null,
  });
});

test('one failed Broadcast does not hold the others', async () => {
  const other = 'c'.repeat(24);
  const h = harness({
    publishing: [
      { broadcastId, roundId, feedKey: 'bad', linkHash: null, over: false },
      {
        broadcastId: other,
        roundId,
        feedKey: 'good',
        linkHash: null,
        over: false,
      },
    ],
    put: async (key) => {
      if (key.includes('bad')) throw new Error('storage');
    },
  });
  await h.publisher.pass();
  assert({
    given: 'one write failing',
    should: 'report it and still publish the other',
    actual: [h.puts.map((put) => put.key), h.failures],
    expected: [['state/good-public.json'], [{ cause: 'publish', failed: 1 }]],
  });
});

test('a lost count on a new bucket keeps the rate in force', async () => {
  let nowMs = NOW;
  let count: () => Promise<number> = async () => 400_000;
  const h = harness({ count: () => count(), now: () => nowMs });
  await h.publisher.pass();
  const lowered = JSON.parse(h.puts.at(-1)!.body).pulseRate;
  nowMs += 60_000;
  count = () => Promise.reject(new Error('down'));
  await h.publisher.pass();
  assert({
    given: 'the viewer count lost as the bucket moves',
    should: 'keep the lowered rate, not ask every tab to pulse',
    actual: [lowered < 1, JSON.parse(h.puts.at(-1)!.body).pulseRate],
    expected: [true, lowered],
  });
});

test('a restart keeps the sampling tabs already hold', async () => {
  const rate = 0.005;
  const h = harness({
    count: async () => 500,
    now: () => NOW + 60_000,
    published: JSON.stringify({
      ...stateOf(await firstState()),
      publishedAtMs: NOW,
      pulseRate: rate,
    }),
  });
  await h.publisher.pass();
  const state = stateOf(h.puts.at(-1)!.body);
  assert({
    given: 'a new process finding a state published at a low rate',
    should: 'scale by that rate and keep it for the same crowd',
    actual: [state.audience.viewers, state.pulseRate],
    expected: [viewersFromSample(500, rate), rate],
  });
});

test('a count that collapses raises the rate only by double', async () => {
  let nowMs = NOW;
  let count = 400_000;
  const h = harness({ count: async () => count, now: () => nowMs });
  await h.publisher.pass();
  const lowered = stateOf(h.puts.at(-1)!.body).pulseRate;
  count = 0;
  nowMs += 60_000;
  await h.publisher.pass();
  assert({
    given: 'an emptied count across a bucket move',
    should: 'double the rate, not ask every tab to pulse',
    actual: stateOf(h.puts.at(-1)!.body).pulseRate,
    expected: lowered * 2,
  });
});

test('many failures in one pass report once, with their count', async () => {
  const h = harness({
    publishing: ['bad-one', 'bad-two'].map((feedKey) => ({
      broadcastId: `${feedKey}-broadcast`,
      roundId,
      feedKey,
      linkHash: null,
      over: false,
    })),
    put: async () => {
      throw new Error('storage');
    },
  });
  await h.publisher.pass();
  assert({
    given: 'every write in a pass failing',
    should: 'report one failure naming the count and no error text',
    actual: h.failures,
    expected: [{ cause: 'publish', failed: 2 }],
  });
});

test('a replaced link moves the state and the old object goes', async () => {
  const h = harness({
    publishing: [
      { broadcastId, roundId, feedKey: 'feed', linkHash: 'one', over: false },
    ],
  });
  await h.publisher.pass();
  h.setPublishing([
    { broadcastId, roundId, feedKey: 'feed', linkHash: 'two', over: false },
  ]);
  await h.publisher.pass();
  assert({
    given: 'the link replaced between passes',
    should: 'publish under the new key and delete the old',
    actual: [h.puts.at(-1)!.key, h.deletes],
    expected: ['state/feed-two.json', ['state/feed-one.json']],
  });
});

test('a closed window deletes the state and records it, once it is gone', async () => {
  const h = harness({
    publishing: [
      { broadcastId, roundId, feedKey: 'feed', linkHash: null, over: true },
    ],
  });
  await h.publisher.pass();
  assert({
    given: 'a Broadcast whose window has closed',
    should: 'write nothing, delete the object, and say so',
    actual: [h.puts.length, h.deletes, h.withdrawn],
    expected: [0, ['state/feed-public.json'], [broadcastId]],
  });
});

test('a Round with no audience publishes nothing', async () => {
  const h = harness({ read: async () => null });
  await h.publisher.pass();
  assert({
    given: 'a Round the read says has no audience',
    should: 'write no state',
    actual: h.puts.length,
    expected: 0,
  });
});
