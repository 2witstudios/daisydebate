import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { runTypingFrame } from './typing-operations';
import { typingWorld } from './typing.test-support';
import { typingAuthority } from './typing-authority';
setupRitewayBun();
function fixture() {
  const f = typingWorld();
  const account = f.accounts[0]!.account;
  let leases: typeof f.leases = [];
  const writes: number[] = [],
    hints: string[] = [];
  let snapshot = { now: f.now, authority: f.authority };
  const input = {
    actor: { actorId: account.actorId, userId: account.userId },
    principal: {
      kind: 'user' as const,
      actorId: account.actorId,
      userId: account.userId,
    },
    channelId: f.channel.channelId,
    bounds: { ttlMs: 5000, refetchMs: 1000, maxActors: 2 },
    refreshAuthority: async () => snapshot,
    read: async () => leases,
    write: async (lease: (typeof f.leases)[number], ttlMs: number) => {
      leases = [lease];
      writes.push(ttlMs);
    },
    clear: async () => {
      leases = [];
    },
    notify: async () => {
      hints.push('thin');
    },
  };
  return {
    ...f,
    input,
    writes,
    hints,
    setSnapshot: (value: typeof snapshot) => {
      snapshot = value;
    },
  };
}
test('actual typing frame emits only aggregate transitions and preserves read-only projection', async () => {
  const f = fixture();
  const first = (await runTypingFrame({ ...f.input, typing: true }))(f.now);
  await runTypingFrame({ ...f.input, typing: true });
  const read = (await runTypingFrame({ ...f.input, typing: undefined }))(f.now);
  await runTypingFrame({ ...f.input, typing: false });
  assert({
    given: 'start, unchanged renewal, own aggregate read and stop',
    should:
      'notify only start/stop, inject exact bounded TTL and expose no actor or content',
    actual: [first, read, f.writes, f.hints],
    expected: [
      {
        version: 1,
        channelId: f.channel.channelId,
        typing: false,
        refreshAfterMs: 1000,
      },
      {
        version: 1,
        channelId: f.channel.channelId,
        typing: false,
        refreshAfterMs: 1000,
      },
      [5000, 5000],
      ['thin', 'thin'],
    ],
  });
});
test('fresh authority refusal around awaits prevents lease mutation and stale time projection', async () => {
  const f = fixture();
  const before = JSON.stringify(f.writes);
  const foreign = { ...f.input.principal, userId: 'x'.repeat(24) };
  await assertRejects({
    given: 'foreign current principal',
    should: 'refuse before Redis write',
    actual: () =>
      runTypingFrame({ ...f.input, principal: foreign, typing: true }),
    code: 'AUTHORIZATION',
  });
  let reads = 0;
  const response = await runTypingFrame({
    ...f.input,
    typing: undefined,
    read: async () => {
      reads++;
      f.setSnapshot({
        now: '2026-10-10T12:00:06.000Z',
        authority: f.authority.map((row) => ({
          ...row,
          input: {
            ...row.input,
            context: { ...row.input.context, now: '2026-10-10T12:00:06.000Z' },
          },
        })),
      });
      return [f.leases[1]!];
    },
  });
  assert({
    given: 'lease expires while Redis read awaits',
    should: 'use refreshed trusted time and never return expired typing',
    actual: [
      response('2026-10-10T12:00:06.000Z').typing,
      reads,
      JSON.stringify(f.writes),
    ],
    expected: [false, 1, before],
  });
});

test('notification completion cannot return a projection stamped before current policy expiry', async () => {
  const f = fixture();
  await assertRejects({
    given:
      'real notify await crosses the current reading/posting evidence lifetime',
    should:
      'refresh canonical current facts before returning HTTP typing metadata',
    actual: () =>
      runTypingFrame({
        ...f.input,
        typing: true,
        notify: async () =>
          f.setSnapshot({
            now: '2027-01-01T00:00:00.000Z',
            authority: f.authority.map((row) => ({
              ...row,
              input: {
                ...row.input,
                context: {
                  ...row.input.context,
                  now: '2027-01-01T00:00:00.000Z',
                },
              },
            })),
          }),
      }),
    code: 'AUTHORIZATION',
  });
});

test('peer lease expiry during notification clears the returned aggregate using fresh canonical evidence', async () => {
  const f = fixture();
  let reads = 0;
  const now = '2026-10-10T12:00:06.000Z';
  const result = await runTypingFrame({
    ...f.input,
    typing: true,
    read: async () => (++reads === 1 ? [] : [f.leases[1]!]),
    notify: async () =>
      f.setSnapshot({
        now,
        authority: typingAuthority({
          channels: f.channels,
          accounts: f.accounts,
          policy: f.policy,
          now,
        }),
      }),
  });
  assert({
    given:
      'a qualifying peer aggregate before notification and expired lease at its completion',
    should: 'return current false without stale peer typing or expired timing',
    actual: result(now),
    expected: {
      version: 1,
      channelId: f.channel.channelId,
      typing: false,
      refreshAfterMs: 1000,
    },
  });
});

test('authorized peer typing refetch is bounded by the actual remaining lease lifetime', async () => {
  const f = fixture();
  const now = '2026-10-10T12:00:04.900Z';
  f.setSnapshot({
    now,
    authority: typingAuthority({
      channels: f.channels,
      accounts: f.accounts,
      policy: f.policy,
      now,
    }),
  });
  const result = await runTypingFrame({
    ...f.input,
    typing: undefined,
    read: async () => [f.leases[1]!],
  });
  assert({
    given: 'a current peer lease with only100ms remaining before expiry',
    should:
      'project typing and refetch by that expiry without renewing or notifying',
    actual: [result(now), f.writes, f.hints],
    expected: [
      {
        version: 1,
        channelId: f.channel.channelId,
        typing: true,
        refreshAfterMs: 100,
      },
      [],
      [],
    ],
  });
});
