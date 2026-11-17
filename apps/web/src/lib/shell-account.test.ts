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

test('a member in the shell (ADR 0143)', () => {
  const member = {
    state: 'member',
    username: 'ada',
    principal: { kind: 'user', userId: 'u', actorId: 'a' },
  } as const;
  const photoId = 'f'.repeat(24);
  assert({
    given:
      'a member with a display name and photo, then one whose card was not read',
    should: 'carry what they chose to show, or nothing, and never their ids',
    actual: [
      shellAccount(member, { displayName: 'Ada Byron', photoId }),
      shellAccount(member),
    ],
    expected: [
      { state: 'member', username: 'ada', displayName: 'Ada Byron', photoId },
      { state: 'member', username: 'ada', displayName: null, photoId: null },
    ],
  });
});
