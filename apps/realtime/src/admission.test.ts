import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createAdmission } from './admission';
setupRitewayBun();
describe('socket admission', () => {
  test('caps unauthenticated peers and releases exactly once', () => {
    const admission = createAdmission({
      now: () => 0,
      maxPerIp: 2,
      maxUnauthenticated: 1,
      maxPerActor: 1,
    });
    const first = admission.reserve('peer');
    const second = admission.reserve('peer');
    first?.release();
    first?.release();
    const third = admission.reserve('peer');
    assert({
      given:
        'two simultaneous unverified sockets from one IP then double close',
      should: 'cap unverified and release without negative counts',
      actual: [!!first, !!second, !!third],
      expected: [true, false, true],
    });
  });
  test('actor limit applies across peer IPs', () => {
    const admission = createAdmission({
      now: () => 0,
      maxPerIp: 2,
      maxUnauthenticated: 2,
      maxPerActor: 1,
    });
    const first = admission.reserve('peer-a')!;
    const second = admission.reserve('peer-b')!;
    assert({
      given: 'two connections for one actor on different peers',
      should: 'limit authenticated connections',
      actual: [first.authenticate('actor'), second.authenticate('actor')],
      expected: [true, false],
    });
  });
});
