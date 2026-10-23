import { assertRejects } from '@daisy/errors/testing';
import { z } from 'zod';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  requireCommandInput,
  requireFencedParticipants,
  requireSameCommand,
} from './round-command-replay';

setupRitewayBun();

const binding = {
  roundId: 'roundaaaa1b2c3d4e5f6g7h8',
  actorId: 'actoraaaa1b2c3d4e5f6g7h8',
  serviceId: null,
  payloadDigest: 'a'.repeat(64),
  type: 'check_in',
};

test('a reused command id replays only for the identical binding', async () => {
  assert({
    given: 'a stored command with the same Round, principal, type and payload',
    should: 'admit the replay',
    actual: requireSameCommand(binding, { ...binding }),
    expected: undefined,
  });
  for (const [field, value] of [
    ['roundId', 'otherroun1b2c3d4e5f6g7h8'],
    ['actorId', 'otheracto1b2c3d4e5f6g7h8'],
    ['actorId', null],
    ['serviceId', 'agent-run:x'],
    ['payloadDigest', 'b'.repeat(64)],
    ['type', 'submit_ballot'],
  ] as const)
    await assertRejects({
      given: `a stored command whose ${field} differs`,
      should: 'refuse the reused command id as a conflict',
      actual: () => requireSameCommand({ ...binding, [field]: value }, binding),
      code: 'CONFLICT',
    });
});

test('Round write input needs a cuid2 Round, a valid envelope and a hex digest', async () => {
  const envelope = z.strictObject({ commandId: z.string() });
  const input = {
    roundId: binding.roundId,
    envelope: { commandId: 'c' },
    payloadDigest: binding.payloadDigest,
  };
  assert({
    given: 'well-formed input',
    should: 'admit it',
    actual: requireCommandInput(input, envelope),
    expected: undefined,
  });
  for (const [label, invalid] of [
    ['a non-cuid2 Round', { ...input, roundId: 'round 1' }],
    ['an envelope the schema refuses', { ...input, envelope: { extra: 1 } }],
    ['an upper-case digest', { ...input, payloadDigest: 'A'.repeat(64) }],
    ['a short digest', { ...input, payloadDigest: 'a'.repeat(63) }],
  ] as const)
    await assertRejects({
      given: label,
      should: 'refuse it as invalid input',
      actual: () => requireCommandInput(invalid, envelope),
      code: 'VALIDATION',
    });
});

test('every current seat must have been fenced before the Round lock', async () => {
  const seats = [{ actorId: 'a' }, { actorId: 'b' }];
  assert({
    given: 'seats all covered by the account fence',
    should: 'admit the write',
    actual: requireFencedParticipants(seats, ['b', 'a', 'host']),
    expected: undefined,
  });
  await assertRejects({
    given: 'a seat that joined after the fence was taken',
    should: 'refuse the write as a conflict',
    actual: () => requireFencedParticipants(seats, ['a']),
    code: 'CONFLICT',
  });
});
