import { assert, setupRitewayBun, test } from 'riteway/bun';
import { authorizationCapabilitySchema } from '@daisy/protocol/authorization';
import { admitsCapability } from './participant-access';

setupRitewayBun();

const capabilities = authorizationCapabilitySchema.options;
const admitted = (
  account: Parameters<typeof admitsCapability>[1],
): readonly string[] =>
  capabilities.filter((capability) => admitsCapability(capability, account));

test('a member who is not admitted keeps exactly the withdrawals (ADR 0075)', () => {
  const withdrawals = [
    'room.leave',
    'channel.leave',
    'social.block',
    'channel.reaction.remove',
    'channel.file.cleanup',
    'channel.invitation.decline',
    'channel.invitation.result',
    'channel.group.archive',
    'channel.group.result',
    'channel.message.remove',
    'channel.request.cancel',
    'channel.request.result',
    'channel.invitation.cancel',
  ];
  const sorted = (values: readonly string[]) => [...values].sort();
  assert({
    given:
      'every capability for a pending, a revoked, an age-unknown and a beta-less account',
    should:
      'allow only own-footprint withdrawals: exits, own cleanup and own replay reads',
    actual: [
      { beta: { state: 'pending' as const }, ageBand: 'adult' as const },
      { beta: { state: 'revoked' as const }, ageBand: 'adult' as const },
      { beta: { state: 'approved' as const }, ageBand: null },
      { beta: null, ageBand: 'adult' as const },
    ].map((account) => sorted(admitted(account))),
    expected: Array.from({ length: 4 }, () => sorted(withdrawals)),
  });
});

test('withdrawals never include adding, transferring authority or reading others (ADR 0075)', () => {
  // channel.manage carries management transfer: it grants authority to
  // someone else, so the last manager without admission archives instead.
  const refused = [
    'channel.post',
    'channel.read',
    'channel.subscribe',
    'channel.manage',
    'channel.invitation.accept',
    'channel.group.invite',
    'room.create',
    'room.read',
    'room.join',
  ] as const;
  assert({
    given:
      'posting, reading, managing, inviting and joining for a pending account',
    should: 'refuse each',
    actual: refused.map((capability) =>
      admitsCapability(capability, {
        beta: { state: 'pending' },
        ageBand: 'adult',
      }),
    ),
    expected: refused.map(() => false),
  });
});

test('an admitted participant holds every capability the rule governs', () => {
  assert({
    given: 'an approved account with an adult age record',
    should: 'admit every capability',
    actual: admitted({ beta: { state: 'approved' }, ageBand: 'adult' }).length,
    expected: capabilities.length,
  });
});
