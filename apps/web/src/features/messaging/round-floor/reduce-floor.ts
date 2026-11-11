import type { FloorEvent } from './floor-events';
import type { FloorState } from './floor-state';
import { rejected, stand, type Event, type FloorStep } from './floor-step';
import { discovered, enter, entryRefused, opened } from './reduce-floor-entry';
import {
  askOlder,
  latestRead,
  olderRead,
  readRefused,
  refresh,
} from './reduce-floor-reads';

const hide = (state: FloorState): FloorStep => {
  const floor = state.standing;
  if (floor.kind !== 'ready') return rejected(state);
  const { thread, settled } = floor;
  const nothingToDrop =
    settled.latest === state.requests &&
    settled.older === state.requests &&
    floor.marking === null &&
    (!thread || (thread.older === null && thread.paging === null));
  if (nothingToDrop) return rejected(state);
  return stand(state, {
    ...floor,
    marking: null,
    settled: { latest: state.requests, older: state.requests },
    // Older text was read under access that is gone; it needs a fresh protected read.
    thread: thread && { ...thread, older: null, paging: null },
  });
};

const messagesShown = (
  state: FloorState,
  event: Event<'messages-shown'>,
): FloorStep => {
  const floor = state.standing;
  if (
    floor.kind !== 'ready' ||
    event.sequence <= floor.readSequence ||
    floor.marking?.sequence === event.sequence
  )
    return rejected(state);
  const request = state.requests + 1;
  return {
    state: {
      requests: request,
      standing: { ...floor, marking: { request, sequence: event.sequence } },
    },
    effects: [
      {
        type: 'mark-read',
        request,
        channelId: floor.metadata.channelId,
        sequence: event.sequence,
      },
    ],
  };
};

const marking = (state: FloorState, request: number) =>
  state.standing.kind === 'ready' && state.standing.marking?.request === request
    ? { floor: state.standing, asked: state.standing.marking.sequence }
    : null;

const readMarked = (state: FloorState, event: Event<'read-marked'>) => {
  const mark = marking(state, event.request);
  if (!mark) return rejected(state);
  const believable =
    Number.isSafeInteger(event.sequence) &&
    event.sequence >= 0 &&
    event.sequence <= mark.asked;
  return stand(state, {
    ...mark.floor,
    marking: null,
    readSequence: believable
      ? Math.max(mark.floor.readSequence, event.sequence)
      : mark.floor.readSequence,
  });
};

/** A failed read marker never claims the messages were read. */
const readMarkFailed = (state: FloorState, request: number) => {
  const mark = marking(state, request);
  return mark
    ? stand(state, { ...mark.floor, marking: null })
    : rejected(state);
};

const expire = (state: FloorState, event: Event<'expiry-reached'>) => {
  const floor = state.standing;
  return floor.kind === 'ready' &&
    !floor.expired &&
    floor.metadata.expiresAt === event.expiresAt
    ? stand(state, { ...floor, expired: true })
    : rejected(state);
};

/** One Round's floor chat: every event in every standing, decided from its inputs alone. */
export function reduceFloor(state: FloorState, event: FloorEvent): FloorStep {
  switch (event.type) {
    case 'enter-requested':
      return enter(state, event);
    case 'discovered':
      return discovered(state, event);
    case 'opened':
      return opened(state, event);
    case 'entry-refused':
      return entryRefused(state, event);
    case 'refresh-requested':
      return refresh(state);
    case 'older-requested':
      return askOlder(state, event);
    case 'latest-read':
      return latestRead(state, event);
    case 'older-read':
      return olderRead(state, event);
    case 'read-refused':
      return readRefused(state, event);
    case 'floor-hidden':
      return hide(state);
    case 'messages-shown':
      return messagesShown(state, event);
    case 'read-marked':
      return readMarked(state, event);
    case 'read-mark-failed':
      return readMarkFailed(state, event.request);
    case 'expiry-reached':
      return expire(state, event);
  }
}
