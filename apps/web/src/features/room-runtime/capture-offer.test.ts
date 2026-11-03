import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { hostHoldsCasualCapture, roomCaptureOffer } from './capture-offer';

setupRitewayBun();

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
        ),
        hostHoldsCasualCapture(
          [{ entitlement: 'casual_ai_judge', source: 'beta' }],
          true,
        ),
        hostHoldsCasualCapture(
          [{ entitlement: 'casual_capture', source: 'beta' }],
          false,
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

test('a closed deployment offers no casual capture', async () => {
  assert({
    given: 'an open casual Room, its host holding the grant, capture closed',
    should: 'say closed, whatever the host holds',
    actual: await roomCaptureOffer(
      {
        hostActorId: 'host',
        status: 'open',
        competitionType: 'casual',
      } as never,
      'host',
      async () => true,
      false,
    ),
    expected: 'closed',
  });
});
