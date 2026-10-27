import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createBotListening } from './listening';

setupRitewayBun();

const id = (c: string) => c.repeat(24);
const scope = {
  roundId: id('r'),
  roundParticipantId: id('b'),
} as never;
const peer = id('p');
const T0 = Date.parse('2026-10-27T12:00:00.000Z');

/** One fake media session: grants, subscriptions and the frames a test plays into them. */
function session(options: { readonly refuse?: () => boolean } = {}) {
  let now = 1000;
  const grants: unknown[] = [];
  const subscriptions: {
    identities: readonly string[];
    url: string;
    token: string;
    frame: (identity: string, sequence: number, level: number) => void;
    trackClosed: (identity: string) => void;
    drop: () => void;
    closed: boolean;
  }[] = [];
  let joined = Promise.withResolvers<void>();
  const events: string[] = [];
  const listening = createBotListening({
    claim: { scope, token: 'claim-token', peerParticipantIds: [peer] },
    listenToken: async (grantScope, token) => {
      grants.push({ grantScope, token });
      if (options.refuse?.())
        throw new Error('Round media admission is closed');
      return {
        url: 'ws://media.test',
        token: `listen-${grants.length}`,
        peers: [
          { participantId: peer, identity: 'peer-identity' },
          { participantId: id('j'), identity: 'other-identity' },
        ],
      };
    },
    subscribe: async (input) => {
      const ended = Promise.withResolvers<'disconnected' | 'closed'>();
      const entry = {
        identities: input.identities,
        url: input.url,
        token: input.token,
        closed: false,
        frame: (identity: string, sequence: number, level: number) =>
          input.onFrame({
            identity,
            trackId: 'TR_peer',
            sequence,
            pcm: new Int16Array(160).fill(level),
            beforeMs: now,
            afterMs: now + 10,
          }),
        trackClosed: (identity: string) =>
          input.onTrackClosed({
            identity,
            trackId: 'TR_peer',
            reason: 'unpublished',
          }),
        drop: () => ended.resolve('disconnected'),
      };
      subscriptions.push(entry);
      joined.resolve();
      return {
        closed: ended.promise,
        setIdentities: async () => undefined,
        close: async () => {
          entry.closed = true;
          ended.resolve('closed');
        },
      };
    },
    databaseNow: async () => new Date(T0 + now).toISOString(),
    monotonicNowMs: () => now,
    playing: () => false,
    onEvent: ({ kind, roundParticipantId }) =>
      events.push(`${kind}:${roundParticipantId}`),
  });
  return {
    listening,
    grants,
    subscriptions,
    events,
    advance: (ms: number) => {
      now += ms;
    },
    /** Resolves when the next subscription lands. */
    joined: () => joined.promise,
    expectJoin: () => {
      joined = Promise.withResolvers<void>();
    },
  };
}

test('the bot hears its peers through its own listen-only grant, with no capture worker in the path (ISSUE-764)', async () => {
  const s = session();
  s.listening.start();
  await s.joined();
  await s.listening.poll();
  for (let sequence = 0; sequence < 20; sequence++) {
    s.subscriptions[0]!.frame('peer-identity', sequence, 8000);
    s.subscriptions[0]!.frame('other-identity', sequence, 8000);
    s.advance(10);
  }
  assert({
    given:
      'a cross-ex seat that joins, then 200 ms of loud audio from its peer and from a seat that is not its peer',
    should:
      "join with the claim's own listen grant, subscribe only its peer, and start that peer's turn",
    actual: {
      grants: s.grants,
      identities: s.subscriptions[0]!.identities,
      token: s.subscriptions[0]!.token,
      events: s.events,
    },
    expected: {
      grants: [{ grantScope: scope, token: 'claim-token' }],
      identities: ['peer-identity'],
      token: 'listen-1',
      events: [`speech-start:${peer}`],
    },
  });
});

test('a closed track or a silent peer reads as unknown, never silence', async () => {
  const s = session();
  s.listening.start();
  await s.joined();
  await s.listening.poll();
  s.subscriptions[0]!.frame('peer-identity', 0, 8000);
  s.subscriptions[0]!.trackClosed('peer-identity');
  assert({
    given: "a peer's track closing",
    should: 'report that peer unknown',
    actual: s.events,
    expected: [`unknown:${peer}`],
  });
});

test('a dropped connection rejoins with a fresh grant; a refused rejoin stays unjoined (ISSUE-764)', async () => {
  let refused = false;
  const s = session({ refuse: () => refused });
  s.listening.start();
  await s.joined();
  s.expectJoin();
  s.subscriptions[0]!.drop();
  await Promise.resolve();
  await s.listening.poll();
  const beforePause = s.subscriptions.length;
  s.advance(1000);
  await s.listening.poll();
  await s.joined();
  // The Round ends or the seat is revoked: its admission refuses the bot.
  refused = true;
  s.subscriptions[1]!.drop();
  await Promise.resolve();
  s.advance(1000);
  await s.listening.poll();
  await s.listening.poll();
  assert({
    given:
      'a drop, a rejoin after its pause, then a drop whose rejoin the admission refuses',
    should:
      'rejoin once with a fresh grant, then stay unjoined: a revoked seat hears nothing',
    actual: {
      beforePause,
      subscriptions: s.subscriptions.map((sub) => sub.token),
      grants: s.grants.length,
    },
    expected: {
      beforePause: 1,
      subscriptions: ['listen-1', 'listen-2'],
      grants: 3,
    },
  });
});

test('the hearing ends with the claim, even while a join is in flight', async () => {
  const s = session();
  s.listening.start();
  await s.joined();
  await s.listening.close();
  await s.listening.poll();
  const late = session();
  late.listening.start();
  const closing = late.listening.close();
  await late.joined();
  await closing;
  assert({
    given:
      'a joined hearing closed with its claim, and one closed before its join landed',
    should: 'close both subscriptions and never rejoin',
    actual: [
      s.subscriptions.map((sub) => sub.closed),
      late.subscriptions.map((sub) => sub.closed),
    ],
    expected: [[true], [true]],
  });
});
