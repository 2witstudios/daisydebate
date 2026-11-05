import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { hostHoldsCasualCapture, roomCaptureOffer } from './capture-offer';

setupRitewayBun();
const now = '2026-11-05T00:00:00.000Z';

const open = {
  hostActorId: 'host',
  status: 'assembling' as const,
  competitionType: 'casual' as const,
};
const yes = async () => true;
const no = async () => false;

describe('What the host is offered', () => {
  test('the capture grant alone speaks for capture', () => {
    assert({
      given:
        'the capture grant, the AI judge grant, and a beta grant at launch',
      should: 'hold only the first, with beta grants counting',
      actual: [
        hostHoldsCasualCapture(
          [{ entitlement: 'casual_capture', source: 'beta' }],
          true,
          now,
        ),
        hostHoldsCasualCapture(
          [{ entitlement: 'casual_ai_judge', source: 'beta' }],
          true,
          now,
        ),
        hostHoldsCasualCapture(
          [{ entitlement: 'casual_capture', source: 'beta' }],
          false,
          now,
        ),
      ],
      expected: [true, false, false],
    });
  });

  test('an open casual Room offers its host what the grant allows', async () => {
    assert({
      given: 'an entitled host and one with no grant',
      should: 'offer the choices to the first and show premium to the second',
      actual: [
        await roomCaptureOffer(open, 'host', yes),
        await roomCaptureOffer(open, 'host', no),
      ],
      expected: ['included', 'premium'],
    });
  });

  test('ranked, another seat and a started Room are offered nothing', async () => {
    assert({
      given: 'each of them',
      should: 'offer nothing, since ranked needs no entitlement',
      actual: [
        await roomCaptureOffer(
          { ...open, competitionType: 'ranked' },
          'host',
          yes,
        ),
        await roomCaptureOffer(open, 'other', yes),
        await roomCaptureOffer({ ...open, status: 'started' }, 'host', yes),
      ],
      expected: [null, null, null],
    });
  });
});
