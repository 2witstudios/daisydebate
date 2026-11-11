import type {
  FloorState,
  FloorThread,
  OpenFloor,
  OutstandingReads,
  ReadKind,
} from './floor-state';
import {
  keptOf,
  rejected,
  stand,
  stopWatching,
  type Event,
  type FloorStep,
} from './floor-step';
import { mergeFloorMessages } from './history';
import type { FloorPageRead } from './view';

/** The open floor, when a read of this kind is on its way to it under this request. */
const awaiting = (
  state: FloorState,
  request: number,
  kind: ReadKind,
): OpenFloor | null =>
  state.standing.kind === 'ready' &&
  state.standing.reads[kind].includes(request)
    ? state.standing
    : null;

const asked = (
  reads: OutstandingReads,
  kind: ReadKind,
  request: number,
): OutstandingReads => ({ ...reads, [kind]: [...reads[kind], request] });

/** An applied read answers for every earlier one of its kind; later ones may still apply. */
const applied = (
  reads: OutstandingReads,
  kind: ReadKind,
  request: number,
): OutstandingReads => ({
  ...reads,
  [kind]: reads[kind].filter((earlier) => earlier > request),
});

/** A failed read answers for itself alone: an earlier one may still apply. */
const failed = (
  reads: OutstandingReads,
  kind: ReadKind,
  request: number,
): OutstandingReads => ({
  ...reads,
  [kind]: reads[kind].filter((other) => other !== request),
});

/** Asks for the floor's latest page under a request of its own. */
export const askLatest = (state: FloorState, floor: OpenFloor): FloorStep => {
  const request = state.requests + 1;
  return {
    state: {
      requests: request,
      standing: { ...floor, reads: asked(floor.reads, 'latest', request) },
    },
    effects: [
      { type: 'read-latest', request, channelId: floor.metadata.channelId },
    ],
  };
};

export const refresh = (state: FloorState): FloorStep =>
  state.standing.kind === 'ready'
    ? askLatest(state, state.standing)
    : rejected(state);

export const askOlder = (
  state: FloorState,
  event: Event<'older-requested'>,
): FloorStep => {
  const floor = state.standing;
  if (floor.kind !== 'ready' || floor.hidden || !floor.thread)
    return rejected(state);
  const request = state.requests + 1;
  return {
    state: {
      requests: request,
      standing: {
        ...floor,
        reads: asked(floor.reads, 'older', request),
        thread: { ...floor.thread, paging: request },
      },
    },
    effects: [
      {
        type: 'read-older',
        request,
        channelId: floor.metadata.channelId,
        before: event.before,
      },
    ],
  };
};

const sameChannel = (floor: OpenFloor, page: FloorPageRead) =>
  page.metadata.channelId === floor.metadata.channelId &&
  page.history.channelId === floor.metadata.channelId;

export const latestRead = (state: FloorState, event: Event<'latest-read'>) => {
  const floor = awaiting(state, event.request, 'latest');
  const { page } = event;
  if (!floor || !sameChannel(floor, page)) return rejected(state);
  const { thread } = floor;
  const expiryMoved = page.metadata.expiresAt !== floor.metadata.expiresAt;
  return stand(
    state,
    {
      ...floor,
      // What the floor is now comes from the newest read of its latest page alone.
      metadata: page.metadata,
      expired: expiryMoved ? false : floor.expired,
      notice: null,
      readSequence: Math.max(floor.readSequence, page.viewer.readSequence),
      reads: applied(floor.reads, 'latest', event.request),
      thread: {
        // A live change may already have moved the history past this read.
        history:
          thread && thread.history.changeVersion > page.history.changeVersion
            ? thread.history
            : page.history,
        authors: page.authors,
        bounds: page.bounds,
        older: thread?.older ?? null,
        paging: thread?.paging ?? null,
      },
    },
    expiryMoved
      ? [{ type: 'watch-expiry', expiresAt: page.metadata.expiresAt }]
      : [],
  );
};

/** Only the older read that Older messages waits for ends its wait. */
const answered = (thread: FloorThread, request: number): FloorThread =>
  thread.paging === request ? { ...thread, paging: null } : thread;

export const olderRead = (state: FloorState, event: Event<'older-read'>) => {
  const floor = awaiting(state, event.request, 'older');
  const { page } = event;
  if (!floor?.thread || !sameChannel(floor, page)) return rejected(state);
  // Applying this read settles every older read asked before it, the awaited one included.
  const thread =
    floor.thread.paging !== null && floor.thread.paging <= event.request
      ? { ...floor.thread, paging: null }
      : floor.thread;
  const { changeVersion } = page.history;
  // An older page adds messages and authors; it never says what the floor is now.
  return stand(state, {
    ...floor,
    notice: null,
    readSequence: Math.max(floor.readSequence, page.viewer.readSequence),
    reads: applied(floor.reads, 'older', event.request),
    thread: {
      ...thread,
      authors: [...thread.authors, ...page.authors],
      older: {
        changeVersion,
        messages: mergeFloorMessages(
          floor.metadata.channelId,
          thread.older?.changeVersion === changeVersion
            ? thread.older.messages
            : [],
          page.history.messages,
        ),
        before: page.history.nextBefore?.sequence ?? null,
      },
    },
  });
};

export const readRefused = (
  state: FloorState,
  event: Event<'read-refused'>,
) => {
  const floor = awaiting(state, event.request, event.read);
  if (!floor) return rejected(state);
  if (event.denied)
    return stand(state, { kind: 'denied', kept: keptOf(floor) }, [
      stopWatching,
    ]);
  return stand(state, {
    ...floor,
    notice: 'read-failed',
    reads: failed(floor.reads, event.read, event.request),
    thread: floor.thread && answered(floor.thread, event.request),
  });
};
