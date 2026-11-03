import type { LiveConnection, MediaState } from './media-state';
import { moved, withLive, type Decision } from './media-step';

/** The current answer is still applying; the next read follows it. */
export const applyHoldsReads = (state: MediaState, live: LiveConnection) =>
  live.apply?.generation === state.intent.generation;

const held = (state: MediaState, live: LiveConnection) =>
  live.reads.flight !== null || applyHoldsReads(state, live);

/** Starts a wanted read unless the one in flight or the current apply holds it. */
export const startNextRead = (
  state: MediaState,
  live: LiveConnection,
  atMs: number,
): Decision => {
  if (live.reads.next === 'none' || held(state, live))
    return moved(withLive(state, live));
  const ticket = state.nextTicket;
  return {
    state: {
      ...state,
      nextTicket: ticket + 1,
      link: {
        ...live,
        reads: {
          ...live.reads,
          next: 'none',
          flight: {
            stage: 'requesting',
            ticket,
            generation: state.intent.generation,
            attempt: 0,
            startedAtMs: atMs,
          },
        },
      },
    },
    effects: [{ type: 'start-read', ticket }],
  };
};

export const wantRead = (live: LiveConnection): LiveConnection =>
  live.reads.next === 'none'
    ? { ...live, reads: { ...live.reads, next: 'wanted' } }
    : live;

/** Asks for a read when this burst of events ends, so the burst costs one. */
export const requestRead = (
  state: MediaState,
  live: LiveConnection,
): Decision => {
  if (live.reads.next === 'starting') return moved(withLive(state, live));
  if (held(state, live)) return moved(withLive(state, wantRead(live)));
  return {
    state: withLive(state, {
      ...live,
      reads: { ...live.reads, next: 'starting' },
    }),
    effects: [{ type: 'defer-read-start' }],
  };
};
