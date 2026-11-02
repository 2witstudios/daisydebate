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

const waitlisted = {
  state: 'waitlisted',
  username: 'y',
  principal: { kind: 'user' },
} as unknown as Identity;

describe('viewerOf', () => {
  test('a public name makes a viewer known, under their real name', () => {
    assert({
      given: 'each identity state',
      should:
        'name members and waitlisted accounts and treat the rest as visitors',
      actual: [anonymous, unavailable, member, provisional, waitlisted].map(
        viewerOf,
      ),
      expected: [
        { signedIn: false },
        { signedIn: false },
        { signedIn: true, handle: 'x' },
        { signedIn: false },
        { signedIn: true, handle: 'y' },
      ],
    });
  });
});
