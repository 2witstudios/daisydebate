import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { Identity } from '@daisy/auth';
import { evaluatedIdentity } from './handler-boundary';

setupRitewayBun();

const principal = { kind: 'user', userId: 'u', actorId: 'a' } as const;

test('messaging hands members and waitlisted accounts to the evaluator (ADR 0075)', () => {
  const identities: Identity[] = [
    { state: 'member', username: 'ada', principal },
    { state: 'waitlisted', username: 'ada', reason: 'revoked', principal },
    { state: 'provisional', principal },
    { state: 'anonymous', principal: { kind: 'anonymous' } },
  ];
  assert({
    given: 'a member, a waitlisted, a provisional and an anonymous identity',
    should:
      'evaluate the member and the waitlisted account (who keeps only withdrawals) and refuse the rest',
    actual: identities.map(evaluatedIdentity),
    expected: [true, true, false, false],
  });
});
