import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { liveCard, liveRow } from './live-card.test-support';

setupRitewayBun();

describe('liveCardOf', () => {
  test('a Round on the floor', () => {
    const card = liveCard();
    assert({
      given: 'released media 30 seconds into the first speech',
      should: 'show that speech, its clock, its speaker and real labels',
      actual: [
        card.href,
        card.phaseName,
        card.secondsLeft,
        card.aff,
        card.neg,
        card.progress,
        card.resolution,
      ],
      expected: [
        '/watch/abcdefghijklmnopqrstuvwx',
        'First affirmative',
        70,
        { label: 'Aff', name: '@ana', speaking: true },
        { label: 'Neg', name: 'Socrates', speaking: false },
        ['current', 'upcoming'],
        'A drawn resolution',
      ],
    });
  });

  test('between speeches', () => {
    const [segment] = liveRow().segments;
    const card = liveCard({
      segments: [
        { ...segment, endedAt: new Date('2026-11-02T00:00:10.000Z') },
      ] as never,
    });
    assert({
      given: 'released media past the end of the last released speech',
      should: 'name no speaker and no clock, and count that speech done',
      actual: [
        card.phaseName,
        card.secondsLeft,
        card.aff.speaking,
        card.progress,
      ],
      expected: ['Between speeches', null, false, ['done', 'upcoming']],
    });
  });
});
