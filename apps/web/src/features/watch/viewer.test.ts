import type { Identity } from '@daisy/auth';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { viewerOf } from './viewer';

setupRitewayBun();

const anonymous = {
  state: 'anonymous',
  principal: { kind: 'anonymous' },
} as unknown as Identity;
const unavailable = {
  state: 'unavailable',
  principal: { kind: 'anonymous' },
} as unknown as Identity;
const member = {
  state: 'member',
  username: 'x',
  principal: { kind: 'user' },
} as unknown as Identity;
const provisional = {
  state: 'provisional',
  principal: { kind: 'user' },
} as unknown as Identity;

describe('viewerOf', () => {
  test('accounts may watch, nobody else', () => {
    assert({
      given: 'each identity state',
      should: 'sign in members and provisional accounts only',
      actual: [anonymous, unavailable, member, provisional].map(
        (identity) => viewerOf(identity).signedIn,
      ),
      expected: [false, false, true, true],
    });
  });
});
