import { assert, setupRitewayBun, test } from 'riteway/bun';
import { freezePostRoundCall } from './post-round-call';

setupRitewayBun();

test('freezePostRoundCall()', () => {
  const human = { kind: 'human' };
  const bot = { kind: 'bot' };
  assert({
    given: 'a Room whose host chose the call, with two humans',
    should: 'keep the choice on the Round',
    actual: freezePostRoundCall(true, [human, bot, human]),
    expected: true,
  });
  assert({
    given: 'a Room whose host chose the call, with one human and a bot',
    should: 'drop it: nobody to talk to',
    actual: freezePostRoundCall(true, [human, bot]),
    expected: false,
  });
  assert({
    given: 'a Room whose host did not choose the call',
    should: 'have none',
    actual: freezePostRoundCall(false, [human, human]),
    expected: false,
  });
});
