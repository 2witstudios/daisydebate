import { assert, setupRitewayBun, test } from 'riteway/bun';
import { guarded } from './sink-guard';
setupRitewayBun();

test('a guarded sink step never throws and says whether it completed', () => {
  const ran: string[] = [];
  assert({
    given: 'a step that completes and a step that throws',
    should: 'run both, answer true then false, and throw nothing',
    actual: [
      guarded(() => void ran.push('ok')),
      guarded(() => {
        ran.push('broke');
        throw new Error('sink down');
      }),
      ran,
    ],
    expected: [true, false, ['ok', 'broke']],
  });
});
