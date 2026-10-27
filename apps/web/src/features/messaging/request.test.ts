import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
import type { MessagingSocialStore } from '@daisy/db/messaging';
import { dec251MessagingValues } from './beta-policy';
import { requestMessagingDm } from './request';
import { messagingSocialDigest } from './social-command-digest';

setupRitewayBun();

const recipientActorId = 'b'.repeat(24),
  channelId = 'c'.repeat(24);
const principal = {
  kind: 'user' as const,
  userId: 'u'.repeat(24),
  actorId: 'a'.repeat(24),
};
const command = {
  version: 1,
  requestId: 'r'.repeat(24),
  recipientActorId,
  introduction: 'Hello',
};

/** A contact store holding `receipt`, whose commit is recorded, never applied. */
const storeWith = (
  receipt: { kind: string; digest: string | null; channelId: string } | null,
  commits: unknown[],
): MessagingSocialStore =>
  ({
    withContacts: async (_scope: unknown, work: (frame: unknown) => unknown) =>
      work({
        readReceipt: async () => receipt,
        readDmRequest: async () => ({ channelId, state: 'pending' }),
        commitDmRequest: async (plan: unknown) => {
          commits.push(plan);
          return { channelId, state: 'pending' };
        },
      }),
  }) as unknown as MessagingSocialStore;

test('a retried DM request with the social limiter spent still returns its stored channel (code-review [7])', async () => {
  const commits: unknown[] = [];
  const spent = async () => {
    throw createAppError('RATE_LIMIT');
  };
  const dependencies = (store: MessagingSocialStore) => ({
    store,
    bounds: { introductionUnits: 100, titleUnits: 80, batchActors: 10 },
    clock: { now: () => '2026-10-27T12:00:00.000Z' },
    ids: { next: () => channelId },
    policyRevision: 1,
    limits: dec251MessagingValues.socialRequests,
    limit: spent,
  });
  const receipt = {
    kind: 'dm.request',
    digest: messagingSocialDigest('dm.request', [recipientActorId, 'Hello']),
    channelId,
  };
  const replayed = await requestMessagingDm(
    command,
    principal,
    dependencies(storeWith(receipt, commits)),
  );
  await assertRejects({
    given: 'a fresh request with the same spent limiter',
    should: 'refuse it as rate limited',
    actual: () =>
      requestMessagingDm(
        command,
        principal,
        dependencies(storeWith(null, commits)),
      ),
    code: 'RATE_LIMIT',
  });
  assert({
    given:
      'a committed request retried after the limiter filled, then a fresh one',
    should:
      'replay the stored channel without committing, and commit nothing for the refused one',
    actual: [replayed, commits.length],
    expected: [{ channelId, state: 'pending' }, 0],
  });
});
