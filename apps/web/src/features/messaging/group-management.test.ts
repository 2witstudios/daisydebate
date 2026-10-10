import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import type { MessagingGroupManagementStore } from '@daisy/db/messaging';
import { manageMessagingGroup } from './group-management';
setupRitewayBun();
const channelId = 'c'.repeat(24),
  requestId = 'r'.repeat(24),
  actorId = 'a'.repeat(24);
const principal = { kind: 'user' as const, userId: 'u'.repeat(24), actorId };
const bounds = { introductionUnits: 30, titleUnits: 30, batchActors: 4 };
const input = { version: 1, channelId, requestId };
function harness(
  overrides: {
    readonly returnedChannel?: string;
    readonly replay?: 'same' | 'foreign-operation' | 'foreign-digest';
  } = {},
) {
  let commits = 0,
    limits = 0;
  const store: MessagingGroupManagementStore = {
    withManagement: async (scope, work) => {
      let digest = '';
      if (overrides.replay) {
        const { messagingSocialDigest } =
          await import('./social-command-digest');
        digest = messagingSocialDigest('group.leave', [channelId, null]);
      }
      return work({
        readResult: async () => ({
          channelId,
          lifecycle: 'archived',
          receipt: overrides.replay
            ? {
                actorId,
                requestId,
                kind:
                  overrides.replay === 'foreign-operation'
                    ? 'group.archive'
                    : 'group.leave',
                digest:
                  overrides.replay === 'foreign-digest'
                    ? 'f'.repeat(64)
                    : digest,
                channelId,
              }
            : null,
        }),
        commit: async () => {
          commits++;
          return {
            channelId: overrides.returnedChannel ?? scope.channelId,
            lifecycle: 'archived',
          };
        },
      });
    },
  };
  return {
    dependencies: {
      store,
      bounds,
      clock: { now: () => '2026-10-10T06:00:00.000Z' },
      limit: async () => {
        limits++;
      },
    },
    counts: () => [commits, limits],
  };
}
test('committed own leave result replays without admission, rate consumption or second write', async () => {
  const h = harness({ replay: 'same' });
  const result = await manageMessagingGroup(
    'leave',
    input,
    principal,
    h.dependencies,
  );
  assert({
    given: 'exact original leave receipt after grant removal/archive',
    should: 'return only minimal current channel result without effects',
    actual: [result, h.counts()],
    expected: [{ version: 1, channelId, lifecycle: 'archived' }, [0, 0]],
  });
});
for (const replay of ['foreign-operation', 'foreign-digest'] as const)
  test(`management refuses ${replay} receipt replay`, async () => {
    const h = harness({ replay });
    await assertRejects({
      given: 'receipt belongs to another operation or target digest',
      should: 'refuse replay',
      actual: () =>
        manageMessagingGroup('leave', input, principal, h.dependencies),
      code: 'CONFLICT',
    });
    assert({
      given: 'mismatched receipt',
      should: 'not rate-consume or write',
      actual: h.counts(),
      expected: [0, 0],
    });
  });
test('management refuses a corrupt provider result for another channel', async () => {
  const h = harness({ returnedChannel: 'z'.repeat(24) });
  await assertRejects({
    given: 'provider returns foreign channel',
    should: 'refuse navigation to unauthorized scope',
    actual: () =>
      manageMessagingGroup('leave', input, principal, h.dependencies),
    code: 'INFRASTRUCTURE',
  });
});
