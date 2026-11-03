import { assert, setupRitewayBun, test } from 'riteway/bun';
import { recoveryDue } from './recovery-due';
setupRitewayBun();

const sessions = ['a', 'b', 'c', 'd'].map((roundId) => ({ roundId }));
const rounds = (due: readonly { readonly roundId: string }[]) =>
  due.map((session) => session.roundId);

test('a tick starts what is free, longest waiting first', () => {
  assert({
    given: 'nothing running and room for every session',
    should: 'start all of them in the order given',
    actual: rounds(recoveryDue(sessions, new Set(), 4)),
    expected: ['a', 'b', 'c', 'd'],
  });
  assert({
    given: 'a session still recovering',
    should: 'skip only that session, so it cannot hold the others',
    actual: rounds(recoveryDue(sessions, new Set(['a']), 4)),
    expected: ['b', 'c', 'd'],
  });
  assert({
    given: 'more sessions than free capacity',
    should: 'start the first ones up to the capacity left',
    actual: rounds(recoveryDue(sessions, new Set(['d']), 3)),
    expected: ['a', 'b'],
  });
  assert({
    given: 'capacity already used',
    should: 'start nothing',
    actual: rounds(recoveryDue(sessions, new Set(['x', 'y']), 2)),
    expected: [],
  });
});
