import { SPECTATOR_MARGIN_MS } from '@daisy/protocol';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  BROADCAST_INTERRUPTED_AFTER_MS,
  projectSpectatorTimeline as project,
} from './timeline';

setupRitewayBun();

type Read = Parameters<typeof project>[0];
const started = new Date('2026-11-02T00:00:00.000Z');
const ended = new Date('2026-11-02T00:10:00.000Z');
const MANIFEST = 'https://feed.daisy.invalid/live/b1/master.m3u8';
const NOW = started.getTime() + 300_000;
const context = { nowMs: NOW, feedUrlOf: () => MANIFEST };
const projectSpectatorTimeline = (facts: Read) => project(facts, context);
const delay60 = { kind: 'delay', seconds: 60 } as const;
const broadcast = (
  over: Partial<NonNullable<Read['broadcast']>> = {},
): NonNullable<Read['broadcast']> => ({
  id: 'b1',
  feedKey: 'k1',
  deliveryPath: 'owned_hls',
  policy: delay60,
  releasedThroughAt: null,
  completedAt: null,
  stoppedAt: null,
  ...over,
});
const stream = { path: 'owned_hls', manifestUrl: MANIFEST } as const;
const read = (over: Partial<Read>, round: Partial<Read['round']> = {}): Read =>
  ({
    round: {
      id: 'abcdefghijklmnopqrstuvwx',
      roomId: 'room',
      visibility: 'public',
      status: 'active',
      competitionType: 'ranked',
      resolution: 'A drawn resolution',
      rules: {
        segments: [
          { key: '1AC', label: 'First affirmative', side: 'affirmative' },
        ],
      },
      outcome: null,
      startedAt: started,
      completedAt: null,
      ...round,
    },
    broadcast: broadcast(),
    recordingStatus: null,
    recordingLifecycle: null,
    recordingJob: null,
    seats: [],
    horizonMs: null,
    segments: [],
    ballots: [],
    ratings: [],
    captions: [],
    outcomeReleased: false,
    ...over,
  }) as Read;
const horizon = (at: Date, plusMs = 0) =>
  at.getTime() + SPECTATOR_MARGIN_MS + plusMs;

describe('projectSpectatorTimeline', () => {
  test('nothing released', () => {
    const view = projectSpectatorTimeline(read({}));
    assert({
      given: 'a live Round with no released media',
      should: 'show a slate, no resolution and no result',
      actual: [view.stage, view.resolution, view.result],
      expected: [{ kind: 'slate', moment: 'unreleased' }, null, null],
    });
  });

  test('a stopped Broadcast has ended for its audience', () => {
    const view = projectSpectatorTimeline(
      read({
        broadcast: broadcast({ stoppedAt: ended }),
        horizonMs: horizon(started, 30_000),
        segments: [
          {
            type: 'speech',
            key: '1AC',
            startedAt: started,
            endedAt: null,
            durationMs: 100_000,
          },
        ],
      }),
    );
    assert({
      given: 'a stop during a speech the watermark had reached',
      should: 'show it ended, with no result',
      actual: [view.stage, view.result],
      expected: [{ kind: 'ended' }, null],
    });
  });

  test('a Round that has not started', () => {
    assert({
      given: 'an opening Round',
      should: 'be upcoming',
      actual: projectSpectatorTimeline(
        read({}, { status: 'opening', startedAt: null }),
      ).stage,
      expected: { kind: 'upcoming' },
    });
  });

  test('the floor as the released video shows it', () => {
    const view = projectSpectatorTimeline(
      read({
        horizonMs: horizon(started, 30_000),
        segments: [
          {
            type: 'speech',
            key: '1AC',
            startedAt: started,
            endedAt: null,
            durationMs: 100_000,
          },
        ],
      }),
    );
    assert({
      given: 'released media 30 seconds into a speech',
      should:
        'show that speech with the clock at that point, and the resolution',
      actual: [view.stage, view.resolution],
      expected: [
        {
          kind: 'floor',
          segment: 'speech',
          label: 'First affirmative',
          side: 'affirmative',
          remainingMs: 70_000,
        },
        'A drawn resolution',
      ],
    });
  });

  test('a finished speech is a slate until the next is released', () => {
    assert({
      given: 'released media past the end of the last released speech',
      should: 'show a slate',
      actual: projectSpectatorTimeline(
        read({
          horizonMs: horizon(ended),
          segments: [
            {
              type: 'speech',
              key: '1AC',
              startedAt: started,
              endedAt: ended,
              durationMs: 100_000,
            },
          ],
        }),
      ).stage,
      expected: { kind: 'slate', moment: 'speeches_over' },
    });
  });

  test('a slate says what the video shows, from released facts alone', () => {
    const speech = (key: string, endedAt: Date | null) => ({
      type: 'speech' as const,
      key,
      startedAt: started,
      endedAt,
      durationMs: 100_000,
    });
    const rules = {
      segments: [
        { key: '1AC', label: 'First affirmative', side: 'affirmative' },
        { key: '1NC', label: 'First negative', side: 'negative' },
      ],
    } as unknown as Read['round']['rules'];
    const phaseOf = (over: Partial<Read>) => {
      const stage = projectSpectatorTimeline(read(over, { rules })).stage;
      return stage.kind === 'slate' ? stage.moment : stage.kind;
    };
    assert({
      given: 'nothing released at all',
      should: 'say only that nothing is known yet',
      actual: phaseOf({ horizonMs: null }),
      expected: 'unreleased',
    });
    assert({
      given: 'a horizon short of the Round start',
      should: 'not say the Round has begun',
      actual: phaseOf({ horizonMs: started.getTime() - 1000 }),
      expected: 'unreleased',
    });
    assert({
      given: 'the start released and no speech yet',
      should: 'say the first speech is coming',
      actual: phaseOf({ horizonMs: horizon(started), segments: [] }),
      expected: 'before_first_speech',
    });
    assert({
      given: 'a released speech ended with another still to come',
      should: 'say the next speech is coming',
      actual: phaseOf({
        horizonMs: horizon(ended),
        segments: [speech('1AC', ended)],
      }),
      expected: 'between_speeches',
    });
    assert({
      given: 'the last released speech of the format ended',
      should: 'say the judges are deciding',
      actual: phaseOf({
        horizonMs: horizon(ended),
        segments: [speech('1NC', ended)],
      }),
      expected: 'speeches_over',
    });
  });

  test('a released ranked result, and a tie', () => {
    const done = { status: 'completed', completedAt: ended } as const;
    const released = { outcomeReleased: true, horizonMs: horizon(ended) };
    const view = projectSpectatorTimeline(
      read(released, { ...done, outcome: 'negative' }),
    );
    assert({
      given: 'a released ranked outcome',
      should: 'end the stage and name the winner',
      actual: [view.stage, view.result?.winner],
      expected: [{ kind: 'ended' }, 'negative'],
    });
    assert({
      given: 'a released ranked tie',
      should: 'have a null winner, never a draw',
      actual: projectSpectatorTimeline(
        read(released, { ...done, outcome: null }),
      ).result?.winner,
      expected: null,
    });
  });

  test('a casual Round releases its winner alone', () => {
    assert({
      given: 'an ended casual Round',
      should: 'show it ended with the winner, and no scores or reason',
      actual: (() => {
        const view = projectSpectatorTimeline(
          read(
            { outcomeReleased: true, horizonMs: horizon(ended) },
            {
              status: 'completed',
              completedAt: ended,
              competitionType: 'casual',
              outcome: 'affirmative',
            },
          ),
        );
        return [view.stage, view.result];
      })(),
      expected: [
        { kind: 'ended' },
        { winner: 'affirmative', ballots: [], ratings: [] },
      ],
    });
  });

  describe('the Broadcast as its audience can use it', () => {
    const standing = (
      over: Partial<NonNullable<Read['broadcast']>> | null,
      round: Partial<Read['round']> = {},
    ) =>
      projectSpectatorTimeline(
        read({ broadcast: over === null ? null : broadcast(over) }, round),
      ).broadcast;
    const onTime = new Date(NOW - 60_000);
    const justLate = new Date(
      NOW - 60_000 - BROADCAST_INTERRUPTED_AFTER_MS - 1,
    );

    test('no Broadcast', () => {
      assert({
        given: 'a Round with no Broadcast',
        should: 'say so',
        actual: standing(null),
        expected: { state: 'none' },
      });
    });

    test('an unlisted Round', () => {
      assert({
        given: 'an unlisted Round, already admitted past its link',
        should: 'offer the same stream under its feed key',
        actual: standing(
          { releasedThroughAt: onTime },
          { visibility: 'unlisted' },
        ),
        expected: {
          state: 'on_air',
          stream: { path: 'owned_hls', manifestUrl: MANIFEST },
        },
      });
    });

    test('the address comes from the feed key, never the Broadcast id', () => {
      assert({
        given: 'a Broadcast with a random feed key',
        should: 'ask for the feed under that key',
        actual: project(
          read({
            broadcast: broadcast({
              releasedThroughAt: onTime,
              feedKey: 'random-key',
            }),
          }),
          { nowMs: NOW, feedUrlOf: (key) => key },
        ).broadcast,
        expected: {
          state: 'on_air',
          stream: { path: 'owned_hls', manifestUrl: 'random-key' },
        },
      });
    });

    test('a deployment with no public feed', () => {
      assert({
        given: 'no configured feed',
        should: 'offer no stream',
        actual: project(
          read({ broadcast: broadcast({ releasedThroughAt: onTime }) }),
          { nowMs: NOW, feedUrlOf: () => null },
        ).broadcast,
        expected: { state: 'none' },
      });
    });

    test('starting', () => {
      assert({
        given: 'an open Broadcast inside its delay with nothing released',
        should: 'be starting, with no stream to fail on',
        actual: standing({}, { startedAt: new Date(NOW - 60_000) }),
        expected: { state: 'starting' },
      });
    });

    test('on air and interrupted', () => {
      assert({
        given: 'a watermark keeping up with the delay',
        should: 'be on air with the stream',
        actual: standing({ releasedThroughAt: onTime }),
        expected: { state: 'on_air', stream },
      });
      assert({
        given: 'a watermark just past the bound behind its delay',
        should: 'be interrupted, keeping the stream',
        actual: standing({ releasedThroughAt: justLate }),
        expected: { state: 'interrupted', stream },
      });
      assert({
        given: 'a live Round that has never released media, past the bound',
        should: 'be interrupted with nothing to play',
        actual: standing({}, { startedAt: justLate }),
        expected: { state: 'interrupted', stream: null },
      });
    });

    test('held by its policy', () => {
      assert({
        given: 'a Round-long hold on a live Round',
        should: 'be held until the Round ends',
        actual: standing({ policy: { kind: 'round_end' } }),
        expected: { state: 'held', releasesAt: null },
      });
      const atMs = NOW + 60_000;
      assert({
        given: 'a scheduled hold before its time',
        should: 'be held until that time',
        actual: standing({ policy: { kind: 'at', atMs } }),
        expected: {
          state: 'held',
          releasesAt: new Date(atMs).toISOString(),
        },
      });
      assert({
        given: 'a Round-long hold once the Round has ended',
        should: 'no longer be held',
        actual: standing(
          { policy: { kind: 'round_end' } },
          { status: 'completed', completedAt: new Date(NOW - 1000) },
        ),
        expected: { state: 'starting' },
      });
    });

    test('how it finishes', () => {
      assert({
        given: 'a stop, even with released media',
        should: 'be stopped and offer no stream',
        actual: standing({ stoppedAt: ended, releasedThroughAt: onTime }),
        expected: { state: 'stopped' },
      });
      assert({
        given: 'a completed Broadcast with released media',
        should: 'be ended',
        actual: standing({ completedAt: ended, releasedThroughAt: onTime }),
        expected: { state: 'ended' },
      });
      assert({
        given: 'a completed Broadcast that released nothing',
        should: 'be failed',
        actual: standing({ completedAt: ended }),
        expected: { state: 'failed' },
      });
      assert({
        given: 'a finished Round that never released media, past the bound',
        should: 'be failed',
        actual: standing(
          {},
          { status: 'completed', startedAt: justLate, completedAt: justLate },
        ),
        expected: { state: 'failed' },
      });
      assert({
        given: 'a finished Round whose feed went silent past the bound',
        should: 'be ended',
        actual: standing(
          { releasedThroughAt: justLate },
          { status: 'completed', completedAt: justLate },
        ),
        expected: { state: 'ended' },
      });
    });
  });

  test('the Recording follows the release', () => {
    const recording = (over: Partial<Read>) =>
      projectSpectatorTimeline(read(over)).recording;
    assert({
      given: 'a ready Recording before the Round end is released',
      should: 'not be mentioned',
      actual: recording({ recordingStatus: 'ready' }),
      expected: 'none',
    });
    assert({
      given: 'a released end and each Recording status',
      should: 'say ready, processing, failed or none',
      actual: (
        ['ready', 'processing', 'capturing', 'failed', 'removed'] as const
      ).map((recordingStatus) =>
        recording({ recordingStatus, outcomeReleased: true }),
      ),
      expected: ['ready', 'processing', 'processing', 'failed', 'none'],
    });
    const capture = {
      source: { kind: 'own_capture' as const },
      startedAt: '2026-11-03T08:00:00.000Z',
      attempts: [
        { attempt: 1, egressId: 'EG', startedAt: '2026-11-03T08:00:00.000Z' },
      ],
      endedAt: '2026-11-03T09:00:00.000Z',
    };
    const processing: Partial<Read> = {
      recordingStatus: 'processing',
      recordingLifecycle: { status: 'processing', capture },
      recordingJob: {
        status: 'queued',
        attemptCount: 1,
        controlLapses: [],
        progress: { step: 'encoding', done: 60_000, total: 3_600_000 },
      },
    };
    const preparation = (over: Partial<Read>) =>
      projectSpectatorTimeline(read(over)).recordingPreparation;
    assert({
      given: 'a build under way, released',
      should: 'say how far, from the job',
      actual: (() => {
        const seen = preparation({ ...processing, outcomeReleased: true });
        return seen?.stage === 'building' ? seen.progress : null;
      })(),
      expected: { step: 'encoding', done: 60_000, total: 3_600_000 },
    });
    assert({
      given: 'the same build before the end is released',
      should: 'say nothing of it',
      actual: preparation(processing),
      expected: undefined,
    });
    assert({
      given: 'a released end on a stopped Broadcast',
      should: 'withhold the Recording',
      actual: recording({
        recordingStatus: 'ready',
        outcomeReleased: true,
        broadcast: broadcast({ stoppedAt: ended }),
      }),
      expected: 'none',
    });
  });
});
