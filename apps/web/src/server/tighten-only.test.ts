import { assert, setupRitewayBun, test } from 'riteway/bun';
import { tightenOnly } from './tighten-only';

setupRitewayBun();

test('a tighten-only override keeps the floor, takes a tighter value and refuses a looser one, naming it', () => {
  const { atMost, atLeast } = tightenOnly('POLICY');
  const refusal = (run: () => number) => {
    try {
      return run();
    } catch (error) {
      return (error as Error).message;
    }
  };
  assert({
    given: 'no value, a tighter value and a looser value on each side',
    should: 'return the floor, the tighter value, and refuse the looser one',
    actual: [
      atMost('max', 10, undefined),
      atMost('max', 10, 4),
      refusal(() => atMost('max', 10, 11)),
      atLeast('min', 10, undefined),
      atLeast('min', 10, 20),
      refusal(() => atLeast('min', 10, 9)),
    ],
    expected: [
      10,
      4,
      'POLICY.max would loosen DEC-251',
      10,
      20,
      'POLICY.min would loosen DEC-251',
    ],
  });
});
