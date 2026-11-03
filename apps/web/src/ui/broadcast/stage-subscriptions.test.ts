import { VideoQuality } from 'livekit-client';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  applyStageSubscriptions,
  seatMedia,
  subscribesTo,
} from './stage-subscriptions';

setupRitewayBun();

const participant = (
  identity: string,
  tracks: readonly {
    kind: string;
    isMuted?: boolean;
    isSubscribed?: boolean;
  }[],
  log: string[] = [],
) => ({
  identity,
  trackPublications: new Map(
    tracks.map((track, index) => [
      `${identity}-${index}`,
      {
        kind: track.kind,
        isMuted: track.isMuted ?? false,
        isSubscribed: track.isSubscribed ?? false,
        setSubscribed: (on: boolean) => {
          log.push(`${identity} ${track.kind} ${on ? 'on' : 'off'}`);
        },
        setVideoQuality: (quality: VideoQuality) => {
          log.push(`${identity} quality ${VideoQuality[quality]}`);
        },
      },
    ]),
  ),
});

describe('applyStageSubscriptions', () => {
  test('a human judge never reaches the stage', () => {
    const log: string[] = [];
    applyStageSubscriptions(
      [
        participant('judge', [{ kind: 'video' }, { kind: 'audio' }], log),
        participant('aff', [{ kind: 'audio' }], log),
      ],
      ['aff', 'neg'],
      'speech',
    );
    assert({
      given: 'a judge in the room publishing camera and voice, during a speech',
      should: 'subscribe the debater and touch nothing of the judge',
      actual: log,
      expected: ['aff audio on'],
    });
    assert({
      given: 'a debater, a judge and someone unknown',
      should: 'admit only the debater',
      actual: ['aff', 'judge', 'stranger'].map((id) =>
        subscribesTo(['aff'], id),
      ),
      expected: [true, false, false],
    });
  });
  test('video asks for the high layer, so first frames are not the low one', () => {
    const log: string[] = [];
    applyStageSubscriptions(
      [participant('aff', [{ kind: 'video' }], log)],
      ['aff'],
      'speech',
    );
    assert({
      given: 'a debater’s camera',
      should: 'subscribe and request the highest quality',
      actual: log,
      expected: ['aff video on', 'aff quality HIGH'],
    });
  });
  test('a private phase lets go of what it holds', () => {
    const log: string[] = [];
    const held = [
      participant(
        'aff',
        [
          { kind: 'video', isSubscribed: true },
          { kind: 'audio', isSubscribed: true },
        ],
        log,
      ),
    ];
    for (const phase of ['prep', 'judging', 'slate'] as const)
      applyStageSubscriptions(held, ['aff'], phase);
    assert({
      given: 'prep, judging and a slate, with a live subscription',
      should: 'unsubscribe in each',
      actual: log.length,
      expected: 6,
    });
  });
});

describe('seatMedia', () => {
  const human = { kind: 'human', identity: 'aff' } as const;
  test('says what each seat actually has', () => {
    assert({
      given: 'camera on, camera muted, no camera, a bot, and nobody connected',
      should: 'name each honestly',
      actual: [
        seatMedia(human, [participant('aff', [{ kind: 'video' }])]),
        seatMedia(human, [
          participant('aff', [{ kind: 'video', isMuted: true }]),
        ]),
        seatMedia(human, [participant('aff', [{ kind: 'audio' }])]),
        seatMedia({ kind: 'bot', identity: 'aff' }, [
          participant('aff', [{ kind: 'audio' }]),
        ]),
        seatMedia({ kind: 'human', identity: null }, []),
      ],
      expected: ['video', 'camera-off', 'camera-off', 'voice-only', 'away'],
    });
  });
});
