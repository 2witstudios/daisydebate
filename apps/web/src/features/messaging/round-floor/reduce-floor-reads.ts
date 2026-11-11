import type {
  FloorState,
  FloorThread,
  OpenFloor,
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

/** The open floor, when this read was asked of it and no later one of its kind has been applied. */
const awaiting = (
  state: FloorState,
  request: number,
  kind: ReadKind,
): OpenFloor | null =>
  state.standing.kind === 'ready' &&
  request > state.standing.settled[kind] &&
  request <= state.requests
    ? state.standing
    : null;

export const refresh = (state: FloorState): FloorStep => {
  if (state.standing.kind !== 'ready') return rejected(state);
  const request = state.requests + 1;
  return {
    state: { ...state, requests: request },
    effects: [
      {
        type: 'read-latest',
        request,
        channelId: state.standing.metadata.channelId,
      },
    ],
  };
};

export const askOlder = (
  state: FloorState,
  event: Event<'older-requested'>,
): FloorStep => {
  const floor = state.standing;
  if (floor.kind !== 'ready' || !floor.thread) return rejected(state);
  const request = state.requests + 1;
  return {
    state: {
      requests: request,
      standing: { ...floor, thread: { ...floor.thread, paging: request } },
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
      settled: { ...floor.settled, latest: event.request },
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
    settled: { ...floor.settled, older: event.request },
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
  // A failed read settles nothing: an earlier one may still answer.
  return stand(state, {
    ...floor,
    notice: 'read-failed',
    thread: floor.thread && answered(floor.thread, event.request),
  });
};
