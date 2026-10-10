import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
import { createMessagingDmStore } from './dm-store';
import { channelWire } from './channel-wire.test-support';
setupRitewayBun();
const requestId = 'r'.repeat(24),
  now = '2026-10-09T18:00:00.000Z';
const row = [
  'a'.repeat(24),
  'b'.repeat(24),
  'c'.repeat(24),
  'dm',
  'a'.repeat(24),
  'pending',
  'Private request',
  new Date(now),
  null,
];
test('request preview exposes introduction only after fresh dedicated read and stays inside the fenced transaction', async () => {
  const f = channelWire([[]]);
  // The final read is intentionally absent even though discovery/fencing succeeded.
  const modes: string[] = [];
  const store = createMessagingDmStore({
    database: f.database,
    authorize: (mode) => async () => {
      modes.push(mode);
    },
  });
  await assertRejects({
    given: 'request fact disappears after locking',
    should: 'mask absence without falling back to discovery facts',
    actual: () => store.withChannel(f.scope, (frame) => frame.readRequest()),
    code: 'NOT_FOUND',
  });
  assert({
    given: 'fresh fact absence',
    should: 'never grant preview from stale authority',
    actual: modes,
    expected: [],
  });
});
test('request decisions require observation and matching operation before writes, then advance authority once', async () => {
  const f = channelWire([]);
  // Scripted results are supplied through a separate frame to retain real driver mapping.
  const command = { requestId, decision: 'accept' as const };
  const fact = f.fact;
  const current = channelWire([
    [{ fact }],
    [row],
    [],
    [{ fact }],
    [[f.scope.channelId]],
    [],
    [],
    [[1, '7']],
    [],
    [],
  ]);
  const modes: string[] = [];
  const store = createMessagingDmStore({
    database: current.database,
    authorize: (mode) => async () => {
      modes.push(mode);
    },
  });
  await store.withChannel(current.scope, async (frame) => {
    await assertRejects({
      given: 'no observed decision',
      should: 'refuse blind commit',
      actual: () =>
        frame.commitDecision({ ...command, digest: 'd'.repeat(64), now }),
      code: 'CONFLICT',
    });
    const state = await frame.readDecisionState(command);
    await assertRejects({
      given: 'a different operation after observation',
      should: 'refuse receipt confusion',
      actual: () =>
        frame.commitDecision({
          ...command,
          decision: 'decline',
          digest: 'd'.repeat(64),
          now,
        }),
      code: 'CONFLICT',
    });
    const result = await frame.commitDecision({
      ...command,
      digest: 'd'.repeat(64),
      now,
    });
    await assertRejects({
      given: 'an already consumed observation',
      should: 'refuse another blind write',
      actual: () =>
        frame.commitDecision({ ...command, digest: 'd'.repeat(64), now }),
      code: 'CONFLICT',
    });
    assert({
      given: 'current pending decision and no receipt',
      should: 'return minimal state and one accepted transition',
      actual: [state, result, modes],
      expected: [
        {
          channelId: current.scope.channelId,
          state: 'pending',
          requestedAt: now,
          receipt: null,
        },
        { channelId: current.scope.channelId, state: 'accepted' },
        ['decide', 'decide'],
      ],
    });
  });
  assert({
    given: 'the accepted decision',
    should: 'record current counterpart and a content-free authority bell',
    actual: [
      current.queries.filter((q) =>
        q.query.startsWith('insert into "messaging_social_commands"'),
      ).length,
      current.queries.some(
        (q) =>
          q.query.startsWith('insert into "messaging_social_commands"') &&
          q.params.includes('b'.repeat(24)),
      ),
      current.queries.filter((q) => q.query.startsWith('insert into "outbox"'))
        .length,
    ],
    expected: [1, true, 1],
  });
});
test('dedicated request authority loss refuses before introduction or receipt access', async () => {
  const f = channelWire([]);
  const fact = f.fact;
  const denied = channelWire([[{ fact }], [{ fact }]]);
  const store = createMessagingDmStore({
    database: denied.database,
    authorize: () => async () => {
      throw createAppError('AUTHORIZATION');
    },
  });
  await store.withChannel(denied.scope, async (frame) => {
    for (const operation of [
      () => frame.readRequest(),
      () => frame.readDecisionState({ requestId, decision: 'cancel' }),
    ])
      await assertRejects({
        given: 'revoked dedicated request authority',
        should: 'refuse preview and retry state',
        actual: operation,
        code: 'AUTHORIZATION',
      });
  });
  assert({
    given: 'dedicated request refusal',
    should: 'read only minimal channel facts and counters',
    actual: denied.queries.some(
      (q) =>
        q.query.includes('from "messaging_dm_pairs"') ||
        q.query.includes('from "messaging_social_commands"'),
    ),
    expected: false,
  });
});

test('closed request replay selects result authority and returns actor-scoped receipt without a decision grant', async () => {
  const base = channelWire([]);
  if (base.fact.authority.kind !== 'dm') throw new Error('DM fixture required');
  const fact = {
    ...base.fact,
    authority: { ...base.fact.authority, state: 'accepted' as const },
  };
  const closed = [...row];
  closed[5] = 'accepted';
  closed[8] = new Date(now);
  const f = channelWire([
    [{ fact }],
    [closed],
    [['dm.decide', 'd'.repeat(64), base.scope.channelId]],
  ]);
  const modes: string[] = [];
  const store = createMessagingDmStore({
    database: f.database,
    authorize: (mode) => async () => {
      modes.push(mode);
    },
  });
  const state = await store.withChannel(f.scope, (frame) =>
    frame.readDecisionState({ requestId, decision: 'accept' }),
  );
  assert({
    given: 'a currently closed accepted pair and own receipt',
    should: 'inspect only the protected result under fresh result capability',
    actual: [state, modes, f.queries.at(-1)?.params],
    expected: [
      {
        channelId: f.scope.channelId,
        state: 'accepted',
        requestedAt: now,
        receipt: {
          kind: 'dm.decide',
          digest: 'd'.repeat(64),
          channelId: f.scope.channelId,
        },
      },
      ['result'],
      [f.scope.actorId, requestId],
    ],
  });
});
test('fresh request preview projects only the dedicated request fields', async () => {
  const base = channelWire([]);
  const f = channelWire([[{ fact: base.fact }], [row]]);
  const store = createMessagingDmStore({
    database: f.database,
    authorize: () => async () => {},
  });
  assert({
    given: 'current request-read authority',
    should:
      'return introduction and request timestamp without history or pair membership',
    actual: await store.withChannel(f.scope, (frame) => frame.readRequest()),
    expected: {
      channelId: f.scope.channelId,
      senderActorId: f.scope.actorId,
      introduction: 'Private request',
      requestedAt: now,
    },
  });
});
