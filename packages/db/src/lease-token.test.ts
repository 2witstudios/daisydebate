import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { leaseTokenDigest, requireLeaseToken } from './lease';

setupRitewayBun();

const token = 'a'.repeat(43);
const digest = leaseTokenDigest(token);

test('a lease token is admitted only against its own stored digest', async () => {
  assert({
    given: 'the token whose SHA3-256 digest is stored',
    should: 'admit it',
    actual: [/^[a-f0-9]{64}$/.test(digest), requireLeaseToken(token, digest)],
    expected: [true, undefined],
  });
  for (const [label, candidate, stored] of [
    ['another well-formed token', 'b'.repeat(43), digest],
    ['a malformed token', 'short', digest],
    ['an uppercase stored digest', token, digest.toUpperCase()],
    ['a truncated stored digest', token, digest.slice(1)],
  ] as const)
    await assertRejects({
      given: label,
      should: 'refuse authority',
      actual: () => requireLeaseToken(candidate, stored),
      code: 'AUTHORIZATION',
    });
});
