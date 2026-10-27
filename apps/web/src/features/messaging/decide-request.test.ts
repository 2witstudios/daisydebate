import { dec251MessagingValues } from './beta-policy';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
import type { MessagingDmStore } from '@daisy/db/messaging';
import { decideMessagingDm } from './decide-request';
import { messagingSocialDigest } from './social-command-digest';
setupRitewayBun();
const command = {
  version: 1,
  channelId: 'channel'.padEnd(24, 'x'),
  requestId: 'request'.padEnd(24, 'x'),
  decision: 'accept',
};
const principal = {
  kind: 'user' as const,
  userId: 'user'.padEnd(24, 'x'),
  actorId: 'recipient'.padEnd(24, 'x'),
};
/** A fresh pending DM whose store and limiter log to `calls`. */
const pendingDecision = () => {
  const world: {
    receipt: {
      kind: string;
      digest: string | null;
      channelId: string | null;
    } | null;
    state: string;
    calls: string[];
  } = { receipt: null, state: 'pending', calls: [] };
  const store: MessagingDmStore = {
    withChannel: async (_scope, work) =>
      work({
        readRequest: async () => {
          throw new Error('Decision must not read introduction');
        },
        readDecisionState: async () => ({
          channelId: command.channelId,
          state: world.state,
          requestedAt: '2026-10-09T18:00:00.000Z',
          receipt: world.receipt,
        }),
        commitDecision: async (plan) => {
          world.calls.push('commit');
          world.receipt = {
            kind: 'dm.decide',
            digest: plan.digest,
            channelId: command.channelId,
          };
          world.state = 'accepted';
          return { channelId: command.channelId, state: 'accepted' };
        },
      }),
  };
  const dependencies = {
    store,
    clock: { now: () => '2026-10-09T18:01:00.000Z' },
    bounds: { introductionUnits: 100, titleUnits: 80, batchActors: 10 },
    limits: dec251MessagingValues.socialRequests,
    limit: async () => {
      world.calls.push('limit');
    },
  };
  return { world, dependencies };
};
test('DM decisions bind retries to the original own receipt without replaying writes', async () => {
  const { world, dependencies } = pendingDecision();
  const first = await decideMessagingDm(command, principal, dependencies);
  const retry = await decideMessagingDm(command, principal, dependencies);
  assert({
    given: 'a successful decision and identical closed retry',
    should:
      'return the original minimal result with one limiter spend and one write: a replay spends nothing',
    actual: [first, retry, world.calls],
    expected: [
      { channelId: command.channelId, state: 'accepted' },
      { channelId: command.channelId, state: 'accepted' },
      ['limit', 'commit'],
    ],
  });
  assert({
    given: 'the same retry once the actor’s social limiter is exhausted',
    should: 'still answer the stored result rather than RATE_LIMIT',
    actual: await decideMessagingDm(command, principal, {
      ...dependencies,
      limit: async () => {
        throw createAppError('RATE_LIMIT');
      },
    }),
    expected: { channelId: command.channelId, state: 'accepted' },
  });
  world.receipt = {
    kind: 'dm.decide',
    digest: messagingSocialDigest('dm.decide', [command.channelId, 'accept']),
    channelId: command.channelId,
  };
  world.state = 'pending';
  await assertRejects({
    given: 'an old own decision receipt after the pair has reopened pending',
    should: 'refuse closed-result replay under a pending mutation grant',
    actual: () => decideMessagingDm(command, principal, dependencies),
    code: 'AUTHORIZATION',
  });
  world.state = 'accepted';
  for (const decision of ['decline', 'cancel'])
    await assertRejects({
      given: `the same own request ID changed to ${decision}`,
      should: 'refuse its changed payload rather than rerun a decision',
      actual: () =>
        decideMessagingDm({ ...command, decision }, principal, dependencies),
      code: 'CONFLICT',
    });
  world.receipt = { ...world.receipt!, channelId: 'foreign'.padEnd(24, 'x') };
  await assertRejects({
    given: 'a receipt linked to another channel',
    should: 'refuse its protected result',
    actual: () => decideMessagingDm(command, principal, dependencies),
    code: 'CONFLICT',
  });
  world.receipt = null;
  await assertRejects({
    given: 'a closed request with no own receipt',
    should: 'deny rather than use result-read authority to mutate it',
    actual: () => decideMessagingDm(command, principal, dependencies),
    code: 'AUTHORIZATION',
  });
});

test('a decision under a clock before the request was made refuses before spending or writing', async () => {
  const { world, dependencies } = pendingDecision();
  await assertRejects({
    given: 'a new decision under a backdated clock',
    should: 'refuse it as invalid',
    actual: () =>
      decideMessagingDm(command, principal, {
        ...dependencies,
        clock: { now: () => '2026-10-09T17:00:00.000Z' },
      }),
    code: 'VALIDATION',
  });
  assert({
    given: 'the refused backdated decision',
    should: 'never have called the limiter or committed the decision',
    actual: [world.calls, world.state, world.receipt],
    expected: [[], 'pending', null],
  });
});
