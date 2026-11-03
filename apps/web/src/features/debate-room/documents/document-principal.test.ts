import type { Identity } from '@daisy/auth';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { roundDocumentPrincipal } from './document-principal';
setupRitewayBun();
test('both server callers receive only the authenticated member user and actor', () => {
  const member: Identity = {
    state: 'member',
    username: 'ada',
    principal: { kind: 'user', userId: 'user-ada', actorId: 'actor-ada' },
  };
  const excluded: readonly Identity[] = [
    { state: 'anonymous', principal: { kind: 'anonymous' } },
    { state: 'unavailable', principal: { kind: 'anonymous' } },
    {
      state: 'provisional',
      principal: { kind: 'user', userId: 'user-ada', actorId: null },
    },
    {
      state: 'waitlisted',
      username: 'ada',
      reason: 'pending',
      principal: { kind: 'user', userId: 'user-ada', actorId: 'actor-ada' },
    },
  ];
  assert({
    given: 'the receipt and live-room canonical server boundary',
    should:
      'pass a real member principal and refuse private-file composition for other states',
    actual: [
      roundDocumentPrincipal(member),
      excluded.map(roundDocumentPrincipal),
    ],
    expected: [
      { userId: 'user-ada', actorId: 'actor-ada' },
      [null, null, null, null],
    ],
  });
});
