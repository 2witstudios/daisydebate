import type { FloorEffect } from './floor-effects';
import type { FloorEvent } from './floor-events';
import type { FloorStanding, FloorState, KeptForms } from './floor-state';

export type FloorStep = {
  readonly state: FloorState;
  readonly effects: readonly FloorEffect[];
};
export type Event<Type extends FloorEvent['type']> = Extract<
  FloorEvent,
  { readonly type: Type }
>;

/** The event does not apply here: the same state object, and nothing asked. */
export const rejected = (state: FloorState): FloorStep => ({
  state,
  effects: [],
});

export const stand = (
  state: FloorState,
  standing: FloorStanding,
  effects: readonly FloorEffect[] = [],
): FloorStep => ({ state: { ...state, standing }, effects });

export const keptOf = (standing: FloorStanding): KeptForms | null => {
  switch (standing.kind) {
    case 'idle':
      return null;
    case 'ready':
      return {
        channelId: standing.metadata.channelId,
        messageUnits: standing.thread?.bounds.messageUnits ?? null,
      };
    default:
      return standing.kept;
  }
};

export const stopWatching: FloorEffect = {
  type: 'watch-expiry',
  expiresAt: null,
};
