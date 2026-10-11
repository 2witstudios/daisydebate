import { assert, setupRitewayBun, test } from 'riteway/bun';
import { currentRoomConsent } from './consent';
setupRitewayBun();
test('prepared consent expires at its conservative SQL deadline', () => {
  const consent = {
    available: true,
    readyActorIds: ['actor'],
    validUntil: '2026-10-11T01:00:01.000Z',
  };
  assert({
    given: 'a lease prepared before transit and SQL lock waits',
    should:
      'retain consent only strictly before its deadline, without extending it',
    actual: [
      '2026-10-11T01:00:00.999Z',
      consent.validUntil,
      '2026-10-11T01:00:02.000Z',
    ].map((now) => currentRoomConsent(consent, now).readyActorIds),
    expected: [['actor'], [], []],
  });
});
