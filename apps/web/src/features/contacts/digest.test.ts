import { assert, setupRitewayBun, test } from 'riteway/bun';
import { contactCommandDigest } from './digest';

setupRitewayBun();

test('a contact command digest is pinned to its version, operation and payload', () => {
  assert({
    given: 'a block of one member, then the same block unblocking',
    should:
      'produce fixed SHA3-256 digests, so a stored receipt keeps replaying across releases',
    actual: [
      contactCommandDigest('contact.block', ['b'.repeat(24), true]),
      contactCommandDigest('contact.block', ['b'.repeat(24), false]),
    ],
    expected: [
      'defe4f0bd755104353e9e3a6163f30d6a6bebd89343ad87aab2e8b6282203c3a',
      'e6d3bde072742f57618107d885daae89f84b18fcaa8d0cc1d55fc1ddecf624b7',
    ],
  });
});
