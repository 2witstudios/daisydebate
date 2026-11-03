import { assert, setupRitewayBun, test } from 'riteway/bun';
import { wayIn } from '../ui/layout/app-shell/components/destinations';
import { shellAccount } from './shell-account';

setupRitewayBun();

test('a restricted account in the shell (ADR 0103)', () => {
  const account = shellAccount({
    state: 'restricted',
    username: 'ada',
    principal: { kind: 'user', userId: 'u', actorId: 'a' },
  });
  assert({
    given: 'a suspended or banned identity',
    should:
      'tell the shell only that, and link its own page under its own label',
    actual: [account, account.state === 'restricted' && wayIn(account)],
    expected: [
      { state: 'restricted' },
      { href: '/restricted', label: 'Account restricted' },
    ],
  });
});
