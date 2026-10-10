import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import type { MessagingDmStore } from '@daisy/db/messaging';
import { decideMessagingDm } from './decide-request';
setupRitewayBun();
test('DM decisions bind retries to the original own receipt without replaying writes', async () => {
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
  let receipt: {
    kind: string;
    digest: string | null;
    channelId: string | null;
  } | null = null;
  let state = 'pending';
  const calls: string[] = [];
  const store: MessagingDmStore = {
    withChannel: async (_scope, work) =>
      work({
        readRequest: async () => {
          throw new Error('Decision must not read introduction');
        },
        readDecisionState: async () => ({
          channelId: command.channelId,
          state,
          requestedAt: '2026-10-09T18:00:00.000Z',
          receipt,
        }),
        commitDecision: async (plan) => {
          calls.push('commit');
          receipt = {
            kind: 'dm.decide',
            digest: plan.digest,
            channelId: command.channelId,
          };
          state = 'accepted';
          return { channelId: command.channelId, state: 'accepted' };
        },
      }),
  };
  const dependencies = {
    store,
    clock: { now: () => '2026-10-09T18:01:00.000Z' },
    bounds: { introductionUnits: 100, titleUnits: 80, batchActors: 10 },
    limit: async () => {
      calls.push('limit');
    },
  };
  const first = await decideMessagingDm(command, principal, dependencies);
  const retry = await decideMessagingDm(command, principal, dependencies);
  assert({
    given: 'a successful decision and identical closed retry',
    should: 'return the original minimal result with one limiter/write only',
    actual: [first, retry, calls],
    expected: [
      { channelId: command.channelId, state: 'accepted' },
      { channelId: command.channelId, state: 'accepted' },
      ['limit', 'commit'],
    ],
  });
  state = 'pending';
  await assertRejects({
    given: 'an old own decision receipt after the pair has reopened pending',
    should: 'refuse closed-result replay under a pending mutation grant',
    actual: () => decideMessagingDm(command, principal, dependencies),
    code: 'AUTHORIZATION',
  });
  state = 'accepted';
  for (const decision of ['decline', 'cancel'])
    await assertRejects({
      given: `the same own request ID changed to ${decision}`,
      should: 'refuse its changed payload rather than rerun a decision',
      actual: () =>
        decideMessagingDm({ ...command, decision }, principal, dependencies),
      code: 'CONFLICT',
    });
  receipt = { ...receipt!, channelId: 'foreign'.padEnd(24, 'x') };
  await assertRejects({
    given: 'a receipt linked to another channel',
    should: 'refuse its protected result',
    actual: () => decideMessagingDm(command, principal, dependencies),
    code: 'CONFLICT',
  });
  receipt = null;
  await assertRejects({
    given: 'a closed request with no own receipt',
    should: 'deny rather than use result-read authority to mutate it',
    actual: () => decideMessagingDm(command, principal, dependencies),
    code: 'AUTHORIZATION',
  });
});
