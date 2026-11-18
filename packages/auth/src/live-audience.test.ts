import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  liveAudience,
  type LiveAudience,
  type LiveAudienceRound,
} from './live-audience';
setupRitewayBun();

const round: LiveAudienceRound = {
  createdByActorId: 'host',
  participants: [{ actorId: 'debater' }, { actorId: 'judge' }],
  youth: null,
};
const youthRound: LiveAudienceRound = {
  ...round,
  youth: { linkedAdultActorIds: ['coach', 'parent'] },
};
const account = (actorId: string) => ({ kind: 'account' as const, actorId });

describe('liveAudience', () => {
  test('a seatless host', () => {
    assert({
      given: 'the host of any Round who holds no seat in it',
      should: 'watch undelayed with no media, as the host',
      actual: [
        liveAudience(round, account('host')),
        liveAudience(youthRound, account('host')),
      ],
      expected: [
        { kind: 'undelayed_no_media', as: 'host' },
        { kind: 'undelayed_no_media', as: 'host' },
      ],
    });
  });

  test("a youth debater's linked adult", () => {
    assert({
      given: 'a coach or parent linked to a youth debater of a Youth Round',
      should: 'watch undelayed with no media, as a linked adult',
      actual: [
        liveAudience(youthRound, account('coach')),
        liveAudience(youthRound, account('parent')),
      ],
      expected: [
        { kind: 'undelayed_no_media', as: 'linked_adult' },
        { kind: 'undelayed_no_media', as: 'linked_adult' },
      ],
    });
  });

  test('anyone else', () => {
    assert({
      given:
        "an adult linked to no debater of the Round (another student's coach, a stranger)",
      should: 'be denied as not in the audience',
      actual: liveAudience(youthRound, account('stranger')),
      expected: { kind: 'denied', reason: 'not_in_audience' },
    });
    assert({
      given: 'an adult who would be linked, on a Round that is not a Youth one',
      should: 'be denied: only a Youth Round has linked adults',
      actual: liveAudience(round, account('coach')),
      expected: { kind: 'denied', reason: 'not_in_audience' },
    });
    assert({
      given: 'a visitor',
      should: 'be denied as signed out',
      actual: liveAudience(youthRound, { kind: 'visitor' }),
      expected: { kind: 'denied', reason: 'signed_out' },
    });
  });

  test('a seat comes first', () => {
    assert({
      given:
        'a seated debater or judge, a seated host, and a linked adult who also holds a seat',
      should: 'be denied as seated: they keep their own seat’s view',
      actual: [
        liveAudience(youthRound, account('debater')),
        liveAudience(youthRound, account('judge')),
        liveAudience(
          { ...youthRound, participants: [{ actorId: 'host' }] },
          account('host'),
        ),
        liveAudience(
          { ...youthRound, participants: [{ actorId: 'coach' }] },
          account('coach'),
        ),
      ],
      expected: Array.from({ length: 4 }, (): LiveAudience => ({
        kind: 'denied',
        reason: 'seated',
      })),
    });
  });
});
