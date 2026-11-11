import type { BroadcastStream, SpectatorTimeline } from '@daisy/protocol';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  PUBLISHING_STALE_AFTER_MS,
  streamableFeedOf,
  timelineAsOf,
  viewerScreenOf,
  viewerSettled,
} from './viewer-screen';
import type { Viewing } from './viewing';

setupRitewayBun();

const stream: BroadcastStream = {
  path: 'owned_hls',
  manifestUrl: 'https://feed.daisy.invalid/live/b/master.m3u8',
};
const floor = {
  kind: 'floor',
  segment: 'speech',
  label: 'First affirmative',
  side: 'affirmative',
  remainingMs: 1000,
} as const;
const timeline = (over: Partial<SpectatorTimeline>): SpectatorTimeline => ({
  version: 1,
  roundId: 'abcdefghijklmnopqrstuvwx',
  mode: 'ranked',
  broadcast: { state: 'on_air', stream },
  recording: 'none',
  resolution: null,
  seats: [],
  stage: floor,
  result: null,
  captions: [],
  releasedThrough: null,
  ...over,
});
const fresh: Viewing = { kind: 'unseen' };
const screen = (over: Partial<SpectatorTimeline>, viewing: Viewing = fresh) =>
  viewerScreenOf(timeline(over), viewing);

describe('streamableFeedOf', () => {
  test('a streamer is offered the feed the audience plays, while it plays', () => {
    const url = stream.manifestUrl;
    assert({
      given: 'on air, and interrupted with released media',
      should: 'offer the audience stream',
      actual: [
        streamableFeedOf(timeline({})),
        streamableFeedOf(
          timeline({ broadcast: { state: 'interrupted', stream } }),
        ),
      ],
      expected: [url, url],
    });
  });

  test('nothing is offered where there is no feed to stream', () => {
    assert({
      given:
        'no Broadcast, starting, interrupted with nothing released, stopped, failed, ended, and not started',
      should: 'offer none',
      actual: [
        { state: 'none' },
        { state: 'starting' },
        { state: 'interrupted', stream: null },
        { state: 'stopped' },
        { state: 'failed' },
        { state: 'ended' },
      ]
        .map((broadcast) =>
          streamableFeedOf(
            timeline({ broadcast } as Partial<SpectatorTimeline>),
          ),
        )
        .concat(streamableFeedOf(timeline({ stage: { kind: 'upcoming' } }))),
      expected: Array.from({ length: 7 }, () => null),
    });
  });
});

describe('viewerScreenOf', () => {
  test('on air', () => {
    assert({
      given: 'a floor on air',
      should: 'play with no notice',
      actual: screen({}),
      expected: { kind: 'player', stream, notice: null },
    });
    assert({
      given: 'a slate on air',
      should: 'keep playing, since the video carries the slate, and say so',
      actual: screen({ stage: { kind: 'slate', moment: 'unreleased' } }),
      expected: { kind: 'player', stream, notice: 'slate' },
    });
    assert({
      given: 'an interruption with released media',
      should: 'keep the player and say so',
      actual: screen({ broadcast: { state: 'interrupted', stream } }),
      expected: { kind: 'player', stream, notice: 'interrupted' },
    });
    assert({
      given: 'an interruption before any media left',
      should: 'say so with no player',
      actual: screen({ broadcast: { state: 'interrupted', stream: null } }),
      expected: { kind: 'interrupted' },
    });
    assert({
      given: 'an engine that gave up on a live stream',
      should: 'offer the failed playback screen',
      actual: screen({}, { kind: 'unplayable', stream, attempt: 0 }),
      expected: { kind: 'unplayable' },
    });
    const next: BroadcastStream = {
      path: 'owned_hls',
      manifestUrl: 'https://feed.daisy.invalid/live/c/master.m3u8',
    };
    assert({
      given: 'an engine that gave up on a stream, and a different one on air',
      should: 'play the one on air',
      actual: screen(
        { broadcast: { state: 'on_air', stream: next } },
        { kind: 'unplayable', stream, attempt: 0 },
      ),
      expected: { kind: 'player', stream: next, notice: null },
    });
  });

  test('before media', () => {
    assert({
      given: 'a Round still opening, on a Broadcast with slate media',
      should: 'be upcoming, with no player',
      actual: screen({ stage: { kind: 'upcoming' } }),
      expected: { kind: 'upcoming' },
    });
    assert({
      given: 'a Broadcast starting',
      should: 'say so',
      actual: screen({
        stage: { kind: 'slate', moment: 'unreleased' },
        broadcast: { state: 'starting' },
      }),
      expected: { kind: 'starting' },
    });
    assert({
      given: 'a Round with no Broadcast',
      should: 'say so',
      actual: screen({ broadcast: { state: 'none' } }),
      expected: { kind: 'no-broadcast' },
    });
  });

  test('how it finishes', () => {
    const playing: Viewing = { kind: 'playing', stream, attempt: 0 };
    assert({
      given: 'a stop while playing',
      should: 'end playback at once',
      actual: screen({ broadcast: { state: 'stopped' } }, playing),
      expected: { kind: 'stopped' },
    });
    assert({
      given: 'a failed Broadcast',
      should: 'say so',
      actual: screen({ broadcast: { state: 'failed' } }),
      expected: { kind: 'failed' },
    });
    assert({
      given: 'a normal end while the viewer is still behind it',
      should: 'let the final seconds play',
      actual: screen({ broadcast: { state: 'ended' } }, playing),
      expected: { kind: 'player', stream, notice: null },
    });
    assert({
      given: 'a normal end the video has reached',
      should: 'show the end with its Recording',
      actual: screen(
        { broadcast: { state: 'ended' }, recording: 'ready' },
        { ...playing, kind: 'finished' },
      ),
      expected: { kind: 'ended', recording: 'ready' },
    });
    assert({
      given: 'a normal end on a stream whose player gave up',
      should: 'show the end, with no player',
      actual: screen(
        { broadcast: { state: 'ended' } },
        { ...playing, kind: 'unplayable' },
      ),
      expected: { kind: 'ended', recording: 'none' },
    });
    assert({
      given: 'a viewer arriving after the end',
      should: 'show the end, with no player',
      actual: screen({
        broadcast: { state: 'ended' },
        recording: 'processing',
      }),
      expected: { kind: 'ended', recording: 'processing' },
    });
    assert({
      given: 'a finished Round that never had a Broadcast',
      should: 'show the end, not a missing Broadcast',
      actual: screen({
        broadcast: { state: 'none' },
        stage: { kind: 'ended' },
      }),
      expected: { kind: 'ended', recording: 'none' },
    });
  });
});

describe('viewerSettled', () => {
  test('polling stops only when nothing can change', () => {
    const ended = { kind: 'ended' } as const;
    assert({
      given: 'on air, a pending Recording, and a final state',
      should: 'keep polling until the final state',
      actual: [
        timeline({}),
        timeline({
          broadcast: { state: 'ended' },
          stage: ended,
          recording: 'processing',
        }),
        timeline({
          broadcast: { state: 'ended' },
          stage: ended,
          recording: 'ready',
        }),
      ].map(viewerSettled),
      expected: [false, false, true],
    });
  });
});

describe('timelineAsOf', () => {
  const onAir = timeline({ broadcast: { state: 'on_air', stream } });
  test('a stale object cannot keep saying on air', () => {
    assert({
      given: 'state that moved within the bound, and state that stopped moving',
      should: 'stand, then say interrupted and keep the stream',
      actual: [
        timelineAsOf(onAir, PUBLISHING_STALE_AFTER_MS).broadcast.state,
        timelineAsOf(onAir, PUBLISHING_STALE_AFTER_MS + 1).broadcast,
      ],
      expected: ['on_air', { state: 'interrupted', stream }],
    });
  });

  test('what has already settled stays settled', () => {
    const ended = timeline({ broadcast: { state: 'ended' } });
    assert({
      given: 'an ended Broadcast whose state no longer moves',
      should: 'still say ended',
      actual: timelineAsOf(ended, PUBLISHING_STALE_AFTER_MS * 10).broadcast
        .state,
      expected: 'ended',
    });
  });
});
