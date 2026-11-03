import { SPECTATOR_MARGIN_MS } from '@daisy/protocol';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { projectSpectatorTimeline } from './timeline';

setupRitewayBun();

type Read = Parameters<typeof projectSpectatorTimeline>[0];
const started = new Date('2026-11-02T00:00:00.000Z');
const ended = new Date('2026-11-02T00:10:00.000Z');
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
    hasBroadcast: true,
    releasedThroughAt: null,
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
      expected: [{ kind: 'slate' }, null, null],
    });
  });

  test('a Round that has not started', () => {
    assert({
      given: 'a scheduled Round',
      should: 'be upcoming',
      actual: projectSpectatorTimeline(
        read({}, { status: 'scheduled', startedAt: null }),
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
      expected: { kind: 'slate' },
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

  test('a casual Round has no public result', () => {
    assert({
      given: 'an ended casual Round',
      should: 'show it ended with no result',
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
      expected: [{ kind: 'ended' }, null],
    });
  });
});
