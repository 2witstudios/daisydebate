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

/**
 * A contact store holding `receipt`, whose commit is recorded, never applied.
 * `refusal` is what opening the frame or its pre-spend screen refuses.
 */
const storeWith = (
  receipt: { kind: string; digest: string | null; channelId: string } | null,
  commits: unknown[],
  refusal: {
    readonly at: 'open' | 'decline';
    readonly code: 'NOT_FOUND' | 'AUTHORIZATION';
  } | null = null,
  converged: {
    readonly channelId: string;
    readonly state: string;
  } | null = null,
): MessagingSocialStore =>
  ({
    withContacts: async (
      _scope: unknown,
      work: (frame: unknown) => unknown,
    ) => {
      if (refusal?.at === 'open') throw createAppError(refusal.code);
      return work({
        readReceipt: async () => receipt,
        screenDmRequest: async () => {
          if (refusal?.at === 'decline') throw createAppError(refusal.code);
          return converged;
        },
        readDmRequest: async () => ({ channelId, state: 'pending' }),
        commitDmRequest: async (plan: unknown) => {
          commits.push(plan);
          return { channelId, state: 'pending' };
        },
      });
    },
  }) as unknown as MessagingSocialStore;

const dependenciesOf = (
  store: MessagingSocialStore,
  limit: (actorId: string) => Promise<void>,
) => ({
  store,
  bounds: { introductionUnits: 100, titleUnits: 80, batchActors: 10 },
  clock: { now: () => '2026-10-27T12:00:00.000Z' },
  ids: { next: () => channelId },
  policyRevision: 1,
  limits: dec251MessagingValues.socialRequests,
  limit,
});

test('a retried DM request with the social limiter spent still returns its stored channel (code-review [7])', async () => {
  const commits: unknown[] = [];
  const spent = async () => {
    throw createAppError('RATE_LIMIT');
  };
  const dependencies = (store: MessagingSocialStore) =>
    dependenciesOf(store, spent);
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

test('an unknown recipient, a block and a decline block refuse alike, spending nothing (DEC-251, plan F7)', async () => {
  const outcomes: unknown[] = [];
  for (const refusal of [
    { at: 'open', code: 'NOT_FOUND' },
    { at: 'open', code: 'AUTHORIZATION' },
    { at: 'decline', code: 'AUTHORIZATION' },
  ] as const) {
    const commits: unknown[] = [];
    const spends: string[] = [];
    const refused = await requestMessagingDm(
      command,
      principal,
      dependenciesOf(storeWith(null, commits, refusal), async (actorId) => {
        spends.push(actorId);
      }),
    ).then(
      () => 'accepted',
      (error: { code?: string }) => error.code,
    );
    outcomes.push({ refused, spends, commits: commits.length });
  }
  assert({
    given:
      'a request to an unknown account, to one in a pair block, and to one whose declines block the requester',
    should:
      'answer each with the same NOT_FOUND, before the limiter and with no commit',
    actual: outcomes,
    expected: Array.from({ length: 3 }, () => ({
      refused: 'NOT_FOUND',
      spends: [],
      commits: 0,
    })),
  });
});

test('asking for an existing DM converges with the social limiter spent, committing nothing', async () => {
  const commits: unknown[] = [];
  const result = await requestMessagingDm(
    command,
    principal,
    dependenciesOf(
      storeWith(null, commits, null, { channelId, state: 'accepted' }),
      async () => {
        throw createAppError('RATE_LIMIT');
      },
    ),
  );
  assert({
    given: 'an accepted DM and a social window already spent',
    should: 'open the conversation without the limiter or a commit',
    actual: [result, commits.length],
    expected: [{ channelId, state: 'accepted' }, 0],
  });
});
