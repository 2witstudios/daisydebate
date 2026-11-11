import type { FloorEffect } from './floor-effects';
import type { FloorEvent } from './floor-events';
import {
  initialFloorState,
  type FloorStanding,
  type FloorState,
} from './floor-state';
import type { FloorMessage } from './history';
import { reduceFloor } from './reduce-floor';
import type { FloorMetadata, FloorPageRead } from './view';

const roundId = 'r'.repeat(24);
export const channelId = 'c'.repeat(24);
export const expiresAt = '2026-11-11T12:00:00.000Z';
export const laterExpiry = '2026-11-12T12:00:00.000Z';

const metadata = (change: Partial<FloorMetadata> = {}): FloorMetadata => ({
  version: 1,
  roundId,
  channelId,
  readOnly: false,
  expiresAt,
  ...change,
});

export const message = (sequence: number, author = 'a'): FloorMessage => ({
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
    readonly metadata?: Partial<FloorMetadata>;
    readonly changeVersion?: number;
    readonly messages?: readonly FloorMessage[];
    readonly before?: number | null;
    readonly readSequence?: number;
    readonly authors?: FloorPageRead['authors'];
    readonly messageUnits?: number;
  } = {},
): FloorPageRead => {
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
export const floorDriver = (from: FloorState = initialFloorState) => {
  let state = from;
  const effects: FloorEffect[] = [];
  const asked = <Type extends FloorEffect['type']>(type: Type) =>
    effects
      .filter(
        (effect): effect is Extract<FloorEffect, { type: Type }> =>
          effect.type === type,
      )
      .at(-1);
  const requestOf = (type: Exclude<FloorEffect['type'], 'watch-expiry'>) =>
    asked(type)?.request ?? NEVER_ASKED;
  const send = (event: FloorEvent) => {
    const step = reduceFloor(state, event);
    state = step.state;
    effects.push(...step.effects);
    return step;
  };
  return {
    send,
    state: () => state,
    effects: () => effects,
    requestOf,
    /** The floor found and its first latest page still on its way. */
    open: (change: Partial<FloorMetadata> = {}) => {
      send({ type: 'enter-requested', mayOpen: true });
      send({
        type: 'discovered',
        request: requestOf('discover'),
        channel: metadata(change),
      });
    },
    /** The floor found and its first latest page read. */
    read: (page: FloorPageRead = pageRead()) => {
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

type Built = readonly [name: string, state: FloorState, inFlight: InFlight];
const build = (
  name: string,
  steps: (floor: ReturnType<typeof floorDriver>) => Partial<InFlight> | void,
): Built => {
  const floor = floorDriver();
  const inFlight = steps(floor) ?? {};
  return [name, floor.state(), { ...nothingInFlight, ...inFlight }];
};

/** One of every shape of standing, each reached through the reducer itself. */
export const everyState = (): readonly Built[] => [
  ['idle', initialFloorState, nothingInFlight],
  build('discovering', (floor) => {
    floor.send({ type: 'enter-requested', mayOpen: true });
    return { entry: floor.requestOf('discover') };
  }),
  build('discovering, may not open', (floor) => {
    floor.send({ type: 'enter-requested', mayOpen: false });
    return { entry: floor.requestOf('discover') };
  }),
  build('opening', (floor) => {
    floor.send({ type: 'enter-requested', mayOpen: true });
    const entry = floor.requestOf('discover');
    floor.send({ type: 'discovered', request: entry, channel: null });
    return { entry };
  }),
  build('empty', (floor) => {
    floor.send({ type: 'enter-requested', mayOpen: false });
    floor.send({
      type: 'discovered',
      request: floor.requestOf('discover'),
      channel: null,
    });
  }),
  build('unavailable', (floor) => {
    floor.send({ type: 'enter-requested', mayOpen: true });
    floor.send({
      type: 'entry-refused',
      request: floor.requestOf('discover'),
      denied: false,
    });
  }),
  build('denied', (floor) => {
    floor.send({ type: 'enter-requested', mayOpen: true });
    floor.send({
      type: 'entry-refused',
      request: floor.requestOf('discover'),
      denied: true,
    });
  }),
  build('denied after reading', (floor) => {
    floor.read();
    floor.send({ type: 'refresh-requested' });
    floor.send({
      type: 'read-refused',
      request: floor.requestOf('read-latest'),
      read: 'latest',
      denied: true,
    });
  }),
  build('ready, first page on its way', (floor) => {
    floor.open();
    return { latest: floor.requestOf('read-latest') };
  }),
  build('ready', (floor) => floor.read()),
  build('ready, refreshing', (floor) => {
    floor.read();
    floor.send({ type: 'refresh-requested' });
    return { latest: floor.requestOf('read-latest') };
  }),
  build('ready, older page on its way', (floor) => {
    floor.read();
    floor.send({ type: 'older-requested', before: 5 });
    return { older: floor.requestOf('read-older') };
  }),
  build('ready, a read failed', (floor) => {
    floor.read();
    floor.send({ type: 'refresh-requested' });
    floor.send({
      type: 'read-refused',
      request: floor.requestOf('read-latest'),
      read: 'latest',
      denied: false,
    });
  }),
  build('ready, marking read', (floor) => {
    floor.read();
    floor.send({ type: 'messages-shown', sequence: 7 });
    return { mark: floor.requestOf('mark-read') };
  }),
  build('ready, expired', (floor) => {
    floor.read();
    floor.send({ type: 'expiry-reached', expiresAt });
  }),
];

/** Every event, carrying the given requests. */
export const everyEvent = (
  inFlight: InFlight,
): readonly (readonly [name: string, event: FloorEvent])[] => [
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
  ['floor-hidden', { type: 'floor-hidden' }],
  ['messages-shown', { type: 'messages-shown', sequence: 9 }],
  ['read-marked', { type: 'read-marked', request: inFlight.mark, sequence: 7 }],
  ['read-mark-failed', { type: 'read-mark-failed', request: inFlight.mark }],
  ['expiry-reached', { type: 'expiry-reached', expiresAt }],
];

const standingShape = (standing: FloorStanding): string => {
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
        ...(thread ? [] : ['first page on its way']),
        ...(standing.metadata.readOnly ? ['read-only'] : []),
        ...(standing.expired ? ['expired'] : []),
        ...(standing.notice ? ['a read failed'] : []),
        ...(thread?.paging != null ? ['older page on its way'] : []),
        ...(thread?.older ? ['older pages'] : []),
        ...(standing.marking ? ['marking read'] : []),
      ].join(', ');
    }
    default:
      return standing.kept ? `${standing.kind}, forms kept` : standing.kind;
  }
};

const effectShape = (effect: FloorEffect) =>
  effect.type === 'watch-expiry'
    ? effect.expiresAt === null
      ? 'stop-watching-expiry'
      : 'watch-expiry'
    : effect.type;

/** One transition as the table states it: where it leads, and what it asks of the world. */
const transitionShape = (next: FloorState, effects: readonly FloorEffect[]) =>
  effects.length === 0
    ? standingShape(next.standing)
    : `${standingShape(next.standing)} | ${effects.map(effectShape).join(', ')}`;

/** Every transition a state allows: an event missing here was rejected. */
export const transitionsOf = (state: FloorState, inFlight: InFlight) => {
  const cells: Record<string, string> = {};
  for (const [name, event] of everyEvent(inFlight)) {
    const step = reduceFloor(state, event);
    if (step.state !== state || step.effects.length > 0)
      cells[name] = transitionShape(step.state, step.effects);
  }
  return cells;
};
