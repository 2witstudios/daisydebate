import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  typingAuthority,
  typingAggregate,
  typingProjectionChanged,
} from './typing-authority';
import { typingWorld } from './typing.test-support';
setupRitewayBun();
test('canonical typing aggregate excludes self and only hints changed publicly visible boolean', () => {
  const f = typingWorld(),
    first = f.leases[0];
  if (!first) throw new Error('Current canonical post lease required');
  assert({
    given: 'one eligible typist and two current readers',
    should: 'show only others typing and never hint unchanged refresh',
    actual: [
      typingAggregate(f.authority, [first], f.ids[0]!, f.now).typing,
      typingAggregate(f.authority, [first], f.ids[1]!, f.now).typing,
      typingProjectionChanged(f.authority, [], [first], f.now),
      typingProjectionChanged(
        f.authority,
        [first],
        [{ ...first, expiresAt: '2026-10-10T12:00:06.000Z' }],
        f.now,
      ),
      typingProjectionChanged(f.authority, [first], [], f.now),
    ],
    expected: [false, true, true, false, true],
  });
});
test('expired, stale-revision, blocked and erased leases cannot qualify even if Redis retains them', () => {
  const f = typingWorld(),
    first = f.leases[0];
  if (!first || f.channel.authority.kind !== 'dm')
    throw new Error('DM lease required');
  const expired = typingAggregate(
    f.authority,
    [first],
    f.ids[1]!,
    first.expiresAt,
  ).typing;
  const stale = [
    'authorityRevision',
    'relationshipRevision',
    'accountRevision',
    'ageRevision',
    'policyRevision',
  ].map(
    (key) =>
      typingAggregate(f.authority, [{ ...first, [key]: 99 }], f.ids[1]!, f.now)
        .typing,
  );
  const blocked = typingAuthority({
    ...f,
    channels: f.channels.map((row) => ({
      ...row,
      fact: {
        ...f.channel,
        authority: { ...f.channel.authority, blocked: true },
      },
    })),
  });
  const erased = typingAuthority({
    ...f,
    accounts: f.accounts.map((row, index) =>
      index ? row : { ...row, account: { ...row.account, erased: true } },
    ),
  });
  assert({
    given: 'retained leases after expiry or canonical account/pair changes',
    should:
      'produce no typing projection and never grant posting from an existing key',
    actual: [
      expired,
      ...stale,
      typingAggregate(blocked, [first], f.ids[1]!, f.now).typing,
      typingAggregate(erased, [first], f.ids[1]!, f.now).typing,
    ],
    expected: Array(8).fill(false),
  });
});
