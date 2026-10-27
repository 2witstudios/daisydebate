import { assert, setupRitewayBun, test } from 'riteway/bun';
import { counterAccepted } from './counter';

setupRitewayBun();
test('counterAccepted', () => {
  const device = (stored: number, received: number) =>
    counterAccepted({ stored, received, backedUp: false });
  assert({
    given: 'a device-bound credential whose counter advances or never counts',
    should: 'accept it',
    actual: [device(4, 5), device(0, 0)],
    expected: [true, true],
  });
  assert({
    given: 'a device-bound credential whose counter repeats or goes back',
    should: 'refuse it',
    actual: [device(5, 5), device(5, 4), device(5, 0)],
    expected: [false, false, false],
  });
  assert({
    given: 'a backed-up credential whose counter goes back',
    should: 'accept it',
    actual: counterAccepted({ stored: 5, received: 0, backedUp: true }),
    expected: true,
  });
});
