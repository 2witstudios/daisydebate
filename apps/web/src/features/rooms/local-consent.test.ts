import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assemblySnapshot } from './assembly.test-support';
import { createLocalConsent } from './local-consent';

setupRitewayBun();
const actorId = assemblySnapshot.hostActorId;
const consentView = (ready: boolean, revision = 1) => ({
  ...assemblySnapshot,
  capabilities: { ...assemblySnapshot.capabilities, canReady: true },
  participants: [
    {
      id: 'p'.repeat(24),
      actorId,
      kind: 'human' as const,
      label: 'Host',
      role: 'affirmative' as const,
      slot: 1,
      needsReady: true,
      eligible: true,
      ready: ready ? ('ready' as const) : ('not-ready' as const),
      consentVersion: revision,
    },
  ],
});

const unreadyEdges = {
  actorId,
  nextId: () => 'x'.repeat(24),
  read: async () => ({ kind: 'found' as const, view: consentView(false) }),
};

function harness(initial = consentView(false)) {
  const sent: Array<{
    type: string;
    expectedVersion: number;
    expectedConsentVersion: number;
  }> = [];
  let view = initial;
  let unavailable = false;
  const controller = createLocalConsent({
    view,
    actorId,
    nextId: () => 'x'.repeat(24),
    read: async () => ({ kind: 'found', view }),
    send: async (command) => {
      sent.push(command);
      if (unavailable) return { kind: 'unavailable' };
      view = consentView(
        command.type === 'ready',
        view.participants[0]!.consentVersion + 1,
      );
      return { kind: 'accepted', view };
    },
  });
  return {
    controller,
    sent,
    fail: () => {
      unavailable = true;
    },
    recover: () => {
      unavailable = false;
    },
  };
}

test('human Ready refuses unchecked devices before any command', async () => {
  const h = harness();
  await h.controller.ready();
  assert({
    given: 'unchecked local devices',
    should: 'leave consent and transport untouched',
    actual: [
      h.sent.length,
      h.controller.readSnapshot().view.participants[0]!.ready,
    ],
    expected: [0, 'not-ready'],
  });
});

test('a Ready made elsewhere survives a mounted Room that has not checked its devices', async () => {
  const h = harness();
  await h.controller.devices(false);
  h.controller.updateView(consentView(true, 2));
  assert({
    given: 'a tab with unchecked devices that reads a Ready made elsewhere',
    should: 'keep the Ready and send no withdrawal',
    actual: [h.sent, h.controller.readSnapshot().pending],
    expected: [[], false],
  });
});

test('a check that starts or fails with no pass held leaves a standing Ready', async () => {
  const h = harness(consentView(true, 2));
  await h.controller.devices(false);
  assert({
    given: 'a reload or new tab whose device snapshot reports no pass',
    should: 'keep the Ready and send no withdrawal',
    actual: [h.sent, h.controller.readSnapshot().pending],
    expected: [[], false],
  });
});

test('a Ready made elsewhere after this tab withdrew on device loss stands', async () => {
  const h = harness(consentView(true, 2));
  await h.controller.devices(true);
  await h.controller.devices(false);
  h.controller.updateView(consentView(true, 4));
  assert({
    given: 'an acknowledged withdrawal, then a newer Ready from another tab',
    should: 'send only the one withdrawal',
    actual: h.sent.map((command) => command.type),
    expected: ['unready'],
  });
});

test('a lost pass withdraws a Ready whose answer was lost after it committed', async () => {
  let server = consentView(false);
  const sent: string[] = [];
  const c = createLocalConsent({
    view: server,
    actorId,
    nextId: () => 'x'.repeat(24),
    read: async () => ({ kind: 'found', view: server }),
    send: async (command) => {
      sent.push(command.type);
      if (command.type === 'ready') {
        server = consentView(true, 2);
        return { kind: 'unavailable' };
      }
      server = consentView(false, 3);
      return { kind: 'accepted', view: server };
    },
  });
  await c.devices(true);
  await c.ready();
  await c.devices(false);
  assert({
    given: 'a committed Ready answered unavailable, then device loss',
    should: 'read the commitment and withdraw it',
    actual: [sent, server.participants[0]!.ready, c.readSnapshot().pending],
    expected: [['ready', 'unready'], 'not-ready', false],
  });
});

test('an unreadable lost Ready stays fenced until a view shows it, then withdraws', async () => {
  const sent: string[] = [];
  const withdrawn = Promise.withResolvers<void>();
  const c = createLocalConsent({
    view: consentView(false),
    actorId,
    nextId: () => 'x'.repeat(24),
    read: async () => ({ kind: 'unavailable' }),
    send: async (command) => {
      sent.push(command.type);
      if (command.type === 'ready') return { kind: 'unavailable' };
      withdrawn.resolve();
      return { kind: 'accepted', view: consentView(false, 3) };
    },
  });
  await c.devices(true);
  await c.ready();
  await c.devices(false);
  const fenced = c.readSnapshot().pending;
  c.updateView(consentView(true, 2));
  await withdrawn.promise;
  assert({
    given: 'a failed reread, then Room sync delivering the committed Ready',
    should: 'hold the fence and then send the owed withdrawal',
    actual: [fenced, sent],
    expected: [true, ['ready', 'unready']],
  });
});

test('device invalidation fences Launch synchronously and withdraws current consent', async () => {
  const h = harness(consentView(true, 7));
  await h.controller.devices(true);
  const work = h.controller.devices(false);
  const blocked = h.controller.readSnapshot().pending;
  await work;
  assert({
    given: 'authoritative Ready and current-device loss',
    should: 'block immediately then acknowledge latest-version Unready',
    actual: [blocked, h.sent[0], h.controller.readSnapshot().pending],
    expected: [
      true,
      {
        type: 'unready',
        commandId: 'x'.repeat(24),
        expectedVersion: 3,
        expectedConsentVersion: 7,
      },
      false,
    ],
  });
});

test('Ready states the capture notice the view showed', async () => {
  const noticed = {
    ...consentView(false),
    captureNotice: { version: 'casual-draft-1', text: 'Exact words.' },
  };
  const h = harness(noticed as unknown as ReturnType<typeof consentView>);
  await h.controller.devices(true);
  await h.controller.ready();
  assert({
    given: 'a view with a capture notice',
    should: 'send its version with Ready',
    actual: (h.sent[0] as { noticeVersion?: string }).noticeVersion,
    expected: 'casual-draft-1',
  });
});

test('unacknowledged Unready stays blocked until authoritative recovery', async () => {
  const h = harness(consentView(true));
  h.fail();
  await h.controller.devices(true);
  await h.controller.devices(false);
  const pending = h.controller.readSnapshot().pending;
  h.recover();
  await h.controller.retry();
  assert({
    given: 'failed withdrawal followed by recovery',
    should: 'retain local fence and reread before acknowledging',
    actual: [
      pending,
      h.controller.readSnapshot().pending,
      h.sent.map((c) => c.type),
    ],
    expected: [true, false, ['unready', 'unready']],
  });
});

test('loss during pending Ready is followed by Unready with consumed consent revision', async () => {
  let finish!: (value: {
    kind: 'accepted';
    view: ReturnType<typeof consentView>;
  }) => void;
  const sent: string[] = [];
  const c = createLocalConsent({
    view: consentView(false),
    ...unreadyEdges,
    send: async (command) => {
      sent.push(command.type);
      if (command.type === 'ready')
        return new Promise((resolve) => {
          finish = resolve;
        });
      return { kind: 'accepted', view: consentView(false, 3) };
    },
  });
  await c.devices(true);
  const ready = c.ready();
  const lost = c.devices(false);
  finish({ kind: 'accepted', view: consentView(true, 2) });
  await Promise.all([ready, lost]);
  assert({
    given: 'device loss while Ready is in flight',
    should: 'withdraw the acknowledged Ready without reopening local Launch',
    actual: [
      sent,
      c.readSnapshot().devicesPassed,
      c.readSnapshot().pending,
      c.readSnapshot().view.participants[0]!.ready,
    ],
    expected: [['ready', 'unready'], false, false, 'not-ready'],
  });
});

test('conflicted Ready rereads current fences instead of restoring stale consent', async () => {
  const commands: Array<{
    expectedVersion: number;
    expectedConsentVersion: number;
  }> = [];
  const latest = { ...consentView(false, 8), version: 4 };
  const c = createLocalConsent({
    view: consentView(false),
    actorId,
    nextId: () => 'x'.repeat(24),
    read: async () => ({ kind: 'found', view: latest }),
    send: async (command) => {
      commands.push(command);
      return commands.length === 1
        ? { kind: 'refused', reason: 'version-conflict' }
        : { kind: 'accepted', view: { ...consentView(true, 9), version: 4 } };
    },
  });
  await c.devices(true);
  await c.ready();
  assert({
    given: 'a version conflict after a room change',
    should: 'submit current intent against reread room and consent revisions',
    actual: commands.map((c) => [c.expectedVersion, c.expectedConsentVersion]),
    expected: [
      [3, 1],
      [4, 8],
    ],
  });
});

test('withdrawal recovery refuses a substituted room and remains locally blocked', async () => {
  let sends = 0;
  const c = createLocalConsent({
    view: consentView(true),
    actorId,
    nextId: () => 'x'.repeat(24),
    read: async () => ({
      kind: 'found',
      view: { ...consentView(false), id: 'z'.repeat(24) },
    }),
    send: async () => {
      sends++;
      return { kind: 'unavailable' };
    },
  });
  await c.devices(true);
  await c.devices(false);
  await c.retry();
  assert({
    given: 'a failed withdrawal and wrong-room recovery payload',
    should:
      'keep original authority and pending fence without another mutation',
    actual: [sends, c.readSnapshot().pending, c.readSnapshot().view.id],
    expected: [1, true, assemblySnapshot.id],
  });
});

test('unchanged acknowledgement cannot loop consent commands', async () => {
  let sends = 0;
  const c = createLocalConsent({
    view: consentView(false),
    ...unreadyEdges,
    send: async () => {
      sends++;
      if (sends > 1) throw new Error('Unexpected repeated mutation');
      return { kind: 'accepted', view: consentView(false) };
    },
  });
  await c.devices(true);
  await c.ready();
  assert({
    given:
      'a valid-shaped acknowledgement that has not consumed the consent revision',
    should: 'remain blocked for reread rather than repeat mutations',
    actual: [sends, c.readSnapshot().pending, c.readSnapshot().problem],
    expected: [1, true, true],
  });
});

test('committed readiness survives local device loss without another intent', async () => {
  const h = harness(consentView(true));
  h.controller.updateView({
    ...consentView(true),
    capabilities: { ...assemblySnapshot.capabilities, canReady: false },
  });
  await h.controller.devices(false);
  await h.controller.unready();
  assert({
    given: 'server-committed readiness then device loss and withdrawal',
    should: 'send no consent mutation and leave no pending intent',
    actual: [h.sent.length, h.controller.readSnapshot().pending],
    expected: [0, false],
  });
});

test('an older consent answer cannot reopen a committed room', async () => {
  const h = harness(consentView(true));
  h.controller.updateView({
    ...consentView(true),
    changeVersion: assemblySnapshot.changeVersion + 1,
    capabilities: { ...assemblySnapshot.capabilities, canReady: false },
  });
  h.controller.updateView(consentView(true));
  await h.controller.unready();
  assert({
    given: 'committed room followed by a delayed pre-commitment answer',
    should: 'retain the commitment and send no withdrawal',
    actual: [
      h.controller.readSnapshot().view.capabilities.canReady,
      h.sent.length,
    ],
    expected: [false, 0],
  });
});

test('late success cannot restore a readiness problem after commitment', async () => {
  const answer =
    Promise.withResolvers<
      Awaited<ReturnType<Parameters<typeof createLocalConsent>[0]['send']>>
    >();
  const c = createLocalConsent({
    view: consentView(false),
    ...unreadyEdges,
    send: () => answer.promise,
  });
  await c.devices(true);
  const pending = c.ready();
  c.updateView({
    ...consentView(true, 2),
    changeVersion: assemblySnapshot.changeVersion + 1,
    capabilities: { ...assemblySnapshot.capabilities, canReady: false },
  });
  answer.resolve({ kind: 'accepted', view: consentView(true, 2) });
  await pending;
  assert({
    given: 'commitment adopted while an older Ready answer is in flight',
    should: 'keep readiness settled without a false cannot-start warning',
    actual: [
      c.readSnapshot().pending,
      c.readSnapshot().problem,
      c.readSnapshot().view.capabilities.canReady,
    ],
    expected: [false, false, false],
  });
});

test('late conflict reread cannot restore a warning after commitment', async () => {
  const read =
    Promise.withResolvers<
      Awaited<ReturnType<Parameters<typeof createLocalConsent>[0]['read']>>
    >();
  const started = Promise.withResolvers<void>();
  const c = createLocalConsent({
    view: consentView(false),
    ...unreadyEdges,
    read: () => {
      started.resolve();
      return read.promise;
    },
    send: async () => ({ kind: 'refused', reason: 'consent-conflict' }),
  });
  await c.devices(true);
  const pending = c.ready();
  await started.promise;
  c.updateView({
    ...consentView(true, 2),
    changeVersion: assemblySnapshot.changeVersion + 1,
    capabilities: { ...assemblySnapshot.capabilities, canReady: false },
  });
  read.resolve({ kind: 'found', view: consentView(false) });
  await pending;
  assert({
    given: 'commitment adopted during an older conflict reread',
    should: 'retain settled consent without an obsolete warning',
    actual: [c.readSnapshot().pending, c.readSnapshot().problem],
    expected: [false, false],
  });
});
