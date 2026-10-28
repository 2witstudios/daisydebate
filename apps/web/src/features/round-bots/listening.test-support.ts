import { createBotListening } from './listening';

const id = (c: string) => c.repeat(24);
export const scope = {
  roundId: id('r'),
  roundParticipantId: id('b'),
} as never;
export const peer = id('p');
export const latePeer = id('l');
const T0 = Date.parse('2026-10-27T12:00:00.000Z');

/** One fake media session: grants, subscriptions and the frames a test plays into them. */
export function session(
  options: {
    /** The admission's refusal for the next grant, if any. */
    readonly refuse?: () => Error | undefined;
    /** How long each PostgreSQL time read takes. */
    readonly readMs?: () => number;
    readonly peers?: readonly string[];
    readonly grantPeers?: readonly {
      readonly participantId: string;
      readonly identity: string;
    }[];
    readonly readPeers?: () => Promise<
      readonly { readonly participantId: string; readonly identity: string }[]
    >;
  } = {},
) {
  let now = 1000;
  const grants: unknown[] = [];
  const subscriptions: {
    identities: string[];
    url: string;
    token: string;
    frame: (identity: string, sequence: number, level: number) => void;
    trackClosed: (identity: string) => void;
    drop: () => void;
    fail: () => void;
    closed: boolean;
  }[] = [];
  let joined = Promise.withResolvers<void>();
  const events: string[] = [];
  /** Each reported join failure, by its message. */
  const failures: string[] = [];
  const listening = createBotListening({
    failed: (error) =>
      failures.push(error instanceof Error ? error.message : String(error)),
    claim: {
      scope,
      token: 'claim-token',
      peerParticipantIds: options.peers ?? [peer],
    },
    readPeers: async () => (await options.readPeers?.()) ?? [],
    listenToken: async (grantScope, token) => {
      grants.push({ grantScope, token });
      const refusal = options.refuse?.();
      if (refusal) throw refusal;
      return {
        url: 'ws://media.test',
        token: `listen-${grants.length}`,
        peers: options.grantPeers ?? [
          { participantId: peer, identity: 'peer-identity' },
          { participantId: id('j'), identity: 'other-identity' },
        ],
      };
    },
    subscribe: async (input) => {
      const ended = Promise.withResolvers<'disconnected' | 'closed'>();
      const entry = {
        identities: [...input.identities],
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
        fail: () => ended.reject(new Error('cleanup failed')),
      };
      subscriptions.push(entry);
      joined.resolve();
      return {
        closed: ended.promise,
        setIdentities: async (identities: readonly string[]) => {
          entry.identities = [...identities];
        },
        close: async () => {
          entry.closed = true;
          ended.resolve('closed');
        },
      };
    },
    databaseNow: async () => {
      const read = new Date(T0 + now).toISOString();
      now += options.readMs?.() ?? 0;
      return read;
    },
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
    failures,
    advance: (ms: number) => {
      now += ms;
    },
    /** 200 ms of loud audio from `identities` on the latest subscription, from frame `first`. */
    speak: (identities: readonly string[], first = 0) => {
      for (let sequence = first; sequence < first + 20; sequence++) {
        for (const identity of identities)
          subscriptions.at(-1)!.frame(identity, sequence, 8000);
        now += 10;
      }
    },
    /** Resolves when the next subscription lands. */
    joined: () => joined.promise,
    expectJoin: () => {
      joined = Promise.withResolvers<void>();
    },
  };
}
