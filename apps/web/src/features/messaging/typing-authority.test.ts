import {
  messagingTestGroupPolicy,
  messagingTestGroupReading,
} from '@daisy/auth/testing';
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

test('sealed peer reading evidence is consumed again at aggregate response time', () => {
  const f = typingWorld();
  const channels: Parameters<typeof typingAuthority>[0]['channels'] = f.ids.map(
    (actorId, index) => ({
      actorId,
      fact: {
        ...f.channel,
        policyKey: 'social.private_group',
        authority: {
          kind: 'private_group',
          actorId,
          role: index ? 'member' : 'manager',
          generation: 1,
          activeMemberActorIds: f.ids,
        },
      },
    }),
  );
  const authority = typingAuthority({
    ...f,
    channels,
    policy: {
      ...f.policy,
      groupPosting: messagingTestGroupPolicy,
      reading: (input) => {
        const proof = messagingTestGroupReading(input);
        return proof &&
          input.channel.authority.kind === 'private_group' &&
          input.channel.authority.actorId === f.ids[1]
          ? { ...proof, validUntil: '2026-10-10T12:00:05.000Z' }
          : proof;
      },
    },
  });
  const peer = authority[1];
  if (!peer?.lease) throw new Error('Canonical peer post lease required');
  const lease = { ...peer.lease, expiresAt: '2026-10-10T12:00:10.000Z' };
  assert({
    given:
      'a manager observer remains readable after the member proof expires before its Redis lease',
    should:
      'clip the visible deadline and refuse the expired sealed peer without minting evidence',
    actual: [
      typingAggregate(
        authority,
        [lease],
        f.ids[0]!,
        '2026-10-10T12:00:04.900Z',
      ),
      typingAggregate(
        authority,
        [lease],
        f.ids[0]!,
        '2026-10-10T12:00:06.000Z',
      ),
    ],
    expected: [
      { typing: true, expiresAt: Date.parse('2026-10-10T12:00:05.000Z') },
      { typing: false, expiresAt: null },
    ],
  });
});
