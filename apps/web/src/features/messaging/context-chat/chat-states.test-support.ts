import type { ContextChatEffect } from './chat-effects';
import type { ContextChatEvent } from './chat-events';
import {
  initialContextChatState,
  type ContextChatStanding,
  type ContextChatState,
} from './chat-state';
import type { ContextChatMessage } from './history';
import { reduceContextChat } from './reduce-chat';
import type { ContextChatMetadata, ContextChatPageRead } from './view';

const roundId = 'r'.repeat(24);
export const channelId = 'c'.repeat(24);
export const expiresAt = '2026-11-11T12:00:00.000Z';
export const laterExpiry = '2026-11-12T12:00:00.000Z';

const metadata = (
  change: Partial<ContextChatMetadata> = {},
): ContextChatMetadata => ({
  version: 1,
  ownerId: roundId,
  channelId,
  readOnly: false,
  expiresAt,
  ...change,
});

export const message = (
  sequence: number,
  author = 'a',
): ContextChatMessage => ({
  id: String(sequence).padStart(24, 'm'),
  channelId,
  sequence,
  changeVersion: sequence,
  authorActorId: author.repeat(24),
  text: `message ${sequence}`,
  createdAt: '2026-11-07T00:00:00.000Z',
  editedAt: null,
  reactions: [],
});

export const pageRead = (
  change: {
    readonly metadata?: Partial<ContextChatMetadata>;
    readonly changeVersion?: number;
    readonly messages?: readonly ContextChatMessage[];
    readonly before?: number | null;
    readonly readSequence?: number;
    readonly authors?: ContextChatPageRead['authors'];
    readonly messageUnits?: number;
  } = {},
): ContextChatPageRead => {
  const before = change.before ?? null;
  return {
    metadata: metadata(change.metadata),
    history: {
      version: 1,
      channelId,
      changeVersion: change.changeVersion ?? 0,
      messages: [...(change.messages ?? [])],
      nextBefore: before === null ? null : { channelId, sequence: before },
    },
    viewer: {
      readSequence: change.readSequence ?? 0,
      firstUnreadSequence: null,
      ownReactions: [],
    },
    authors: change.authors ?? [],
    bounds: { messageUnits: change.messageUnits ?? 4000, pageItems: 100 },
  };
};

/** Runs events through the reducer, remembering each request the model asked for. */
export const contextChatDriver = (
  from: ContextChatState = initialContextChatState,
) => {
  let state = from;
  const effects: ContextChatEffect[] = [];
  const asked = <Type extends ContextChatEffect['type']>(type: Type) =>
    effects
      .filter(
        (effect): effect is Extract<ContextChatEffect, { type: Type }> =>
          effect.type === type,
      )
      .at(-1);
  const requestOf = (
    type: Exclude<ContextChatEffect['type'], 'watch-expiry'>,
  ) => asked(type)?.request ?? NEVER_ASKED;
  const send = (event: ContextChatEvent) => {
    const step = reduceContextChat(state, event);
    state = step.state;
    effects.push(...step.effects);
    return step;
  };
  return {
    send,
    state: () => state,
    effects: () => effects,
    requestOf,
    /** The chat found and its first latest page still on its way. */
    open: (change: Partial<ContextChatMetadata> = {}) => {
      send({ type: 'enter-requested', mayOpen: true });
      send({
        type: 'discovered',
        request: requestOf('discover'),
        channel: metadata(change),
      });
    },
    /** The chat found and its first latest page read. */
    read: (page: ContextChatPageRead = pageRead()) => {
      send({ type: 'enter-requested', mayOpen: true });
      send({
        type: 'discovered',
        request: requestOf('discover'),
        channel: page.metadata,
      });
      send({ type: 'latest-read', request: requestOf('read-latest'), page });
    },
  };
};

/** A request id the model never handed out. */
export const NEVER_ASKED = 999;

export type InFlight = {
  readonly entry: number;
  readonly latest: number;
  readonly older: number;
  readonly mark: number;
};
const nothingInFlight: InFlight = {
  entry: NEVER_ASKED,
  latest: NEVER_ASKED,
  older: NEVER_ASKED,
  mark: NEVER_ASKED,
};

type Built = readonly [
  name: string,
  state: ContextChatState,
  inFlight: InFlight,
];
const build = (
  name: string,
  steps: (
    chat: ReturnType<typeof contextChatDriver>,
  ) => Partial<InFlight> | void,
): Built => {
  const chat = contextChatDriver();
  const inFlight = steps(chat) ?? {};
  return [name, chat.state(), { ...nothingInFlight, ...inFlight }];
};

/** One of every shape of standing, each reached through the reducer itself. */
export const everyState = (): readonly Built[] => [
  ['idle', initialContextChatState, nothingInFlight],
  build('discovering', (chat) => {
    chat.send({ type: 'enter-requested', mayOpen: true });
    return { entry: chat.requestOf('discover') };
  }),
  build('discovering, may not open', (chat) => {
    chat.send({ type: 'enter-requested', mayOpen: false });
    return { entry: chat.requestOf('discover') };
  }),
  build('opening', (chat) => {
    chat.send({ type: 'enter-requested', mayOpen: true });
    const entry = chat.requestOf('discover');
    chat.send({ type: 'discovered', request: entry, channel: null });
    return { entry };
  }),
  build('empty', (chat) => {
    chat.send({ type: 'enter-requested', mayOpen: false });
    chat.send({
      type: 'discovered',
      request: chat.requestOf('discover'),
      channel: null,
    });
  }),
  build('unavailable', (chat) => {
    chat.send({ type: 'enter-requested', mayOpen: true });
    chat.send({
      type: 'entry-refused',
      request: chat.requestOf('discover'),
      denied: false,
    });
  }),
  build('denied', (chat) => {
    chat.send({ type: 'enter-requested', mayOpen: true });
    chat.send({
      type: 'entry-refused',
      request: chat.requestOf('discover'),
      denied: true,
    });
  }),
  build('denied after reading', (chat) => {
    chat.read();
    chat.send({ type: 'refresh-requested' });
    chat.send({
      type: 'read-refused',
      request: chat.requestOf('read-latest'),
      read: 'latest',
      denied: true,
    });
  }),
  build('ready, first page on its way', (chat) => {
    chat.open();
    return { latest: chat.requestOf('read-latest') };
  }),
  build('ready, no page, a read failed', (chat) => {
    chat.open();
    chat.send({
      type: 'read-refused',
      request: chat.requestOf('read-latest'),
      read: 'latest',
      denied: false,
    });
  }),
  build('ready, no page, hidden', (chat) => {
    chat.open();
    chat.send({ type: 'chat-hidden' });
  }),
  build('ready', (chat) => chat.read()),
  build('ready, hidden', (chat) => {
    chat.read();
    chat.send({ type: 'chat-hidden' });
  }),
  build('ready, refreshing', (chat) => {
    chat.read();
    chat.send({ type: 'refresh-requested' });
    return { latest: chat.requestOf('read-latest') };
  }),
  build('ready, older page on its way', (chat) => {
    chat.read();
    chat.send({ type: 'older-requested', before: 5 });
    return { older: chat.requestOf('read-older') };
  }),
  build('ready, a read failed', (chat) => {
    chat.read();
    chat.send({ type: 'refresh-requested' });
    chat.send({
      type: 'read-refused',
      request: chat.requestOf('read-latest'),
      read: 'latest',
      denied: false,
    });
  }),
  build('ready, marking read', (chat) => {
    chat.read();
    chat.send({ type: 'messages-shown', sequence: 7 });
    return { mark: chat.requestOf('mark-read') };
  }),
  build('ready, expired', (chat) => {
    chat.read();
    chat.send({ type: 'expiry-reached', expiresAt });
  }),
];

/** Every event, carrying the given requests. */
export const everyEvent = (
  inFlight: InFlight,
): readonly (readonly [name: string, event: ContextChatEvent])[] => [
  ['enter-requested', { type: 'enter-requested', mayOpen: true }],
  [
    'discovered a channel',
    { type: 'discovered', request: inFlight.entry, channel: metadata() },
  ],
  [
    'discovered none',
    { type: 'discovered', request: inFlight.entry, channel: null },
  ],
  ['opened', { type: 'opened', request: inFlight.entry, metadata: metadata() }],
  [
    'entry-refused denied',
    { type: 'entry-refused', request: inFlight.entry, denied: true },
  ],
  [
    'entry-refused failed',
    { type: 'entry-refused', request: inFlight.entry, denied: false },
  ],
  ['refresh-requested', { type: 'refresh-requested' }],
  ['older-requested', { type: 'older-requested', before: 5 }],
  [
    'latest-read',
    { type: 'latest-read', request: inFlight.latest, page: pageRead() },
  ],
  [
    'latest-read closed, expiring later',
    {
      type: 'latest-read',
      request: inFlight.latest,
      page: pageRead({
        metadata: { readOnly: true, expiresAt: laterExpiry },
      }),
    },
  ],
  [
    'older-read',
    {
      type: 'older-read',
      request: inFlight.older,
      page: pageRead({ messages: [message(4)], before: 4 }),
    },
  ],
  ...(['latest', 'older'] as const).flatMap((read) =>
    ([true, false] as const).map(
      (denied) =>
        [
          `read-refused ${read} ${denied ? 'denied' : 'failed'}`,
          { type: 'read-refused', request: inFlight[read], read, denied },
        ] as const,
    ),
  ),
  ['chat-hidden', { type: 'chat-hidden' }],
  ['chat-shown', { type: 'chat-shown' }],
  ['messages-shown', { type: 'messages-shown', sequence: 9 }],
  ['read-marked', { type: 'read-marked', request: inFlight.mark, sequence: 7 }],
  ['read-mark-failed', { type: 'read-mark-failed', request: inFlight.mark }],
  ['expiry-reached', { type: 'expiry-reached', expiresAt }],
];

const standingShape = (standing: ContextChatStanding): string => {
  switch (standing.kind) {
    case 'idle':
      return 'idle';
    case 'loading':
      return standing.step === 'opening'
        ? 'opening'
        : standing.mayOpen
          ? 'discovering'
          : 'discovering, may not open';
    case 'ready': {
      const { thread } = standing;
      return [
        'ready',
        ...(thread
          ? []
          : [
              standing.reads.latest.length > 0
                ? 'first page on its way'
                : 'no page',
            ]),
        ...(standing.hidden ? ['hidden'] : []),
        ...(standing.metadata.readOnly ? ['read-only'] : []),
        ...(standing.expired ? ['expired'] : []),
        ...(standing.notice ? ['a read failed'] : []),
        ...(thread?.paging != null ? ['older page on its way'] : []),
        ...(thread?.older ? ['older pages'] : []),
        ...(standing.marking ? ['marking read'] : []),
      ].join(', ');
    }
    case 'empty':
    case 'unavailable':
    case 'denied':
      return standing.kept ? `${standing.kind}, forms kept` : standing.kind;
  }
};

const effectShape = (effect: ContextChatEffect) =>
  effect.type === 'watch-expiry'
    ? effect.expiresAt === null
      ? 'stop-watching-expiry'
      : 'watch-expiry'
    : effect.type;

/** One transition as the table states it: where it leads, and what it asks of the world. */
const transitionShape = (
  next: ContextChatState,
  effects: readonly ContextChatEffect[],
) =>
  effects.length === 0
    ? standingShape(next.standing)
    : `${standingShape(next.standing)} | ${effects.map(effectShape).join(', ')}`;

/** Every transition a state allows: an event missing here was rejected. */
export const transitionsOf = (state: ContextChatState, inFlight: InFlight) => {
  const cells: Record<string, string> = {};
  for (const [name, event] of everyEvent(inFlight)) {
    const step = reduceContextChat(state, event);
    if (step.state !== state || step.effects.length > 0)
      cells[name] = transitionShape(step.state, step.effects);
  }
  return cells;
};
