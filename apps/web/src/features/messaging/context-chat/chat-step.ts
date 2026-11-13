import type { ContextChatEffect } from './chat-effects';
import type { ContextChatEvent } from './chat-events';
import type {
  ContextChatStanding,
  ContextChatState,
  KeptForms,
} from './chat-state';

export type ContextChatStep = {
  readonly state: ContextChatState;
  readonly effects: readonly ContextChatEffect[];
};
export type Event<Type extends ContextChatEvent['type']> = Extract<
  ContextChatEvent,
  { readonly type: Type }
>;

/** The event does not apply here: the same state object, and nothing asked. */
export const rejected = (state: ContextChatState): ContextChatStep => ({
  state,
  effects: [],
});

export const stand = (
  state: ContextChatState,
  standing: ContextChatStanding,
  effects: readonly ContextChatEffect[] = [],
): ContextChatStep => ({ state: { ...state, standing }, effects });

export const keptOf = (standing: ContextChatStanding): KeptForms | null => {
  switch (standing.kind) {
    case 'idle':
      return null;
    case 'ready':
      return {
        channelId: standing.metadata.channelId,
        messageUnits: standing.thread?.bounds.messageUnits ?? null,
      };
    case 'loading':
    case 'empty':
    case 'unavailable':
    case 'denied':
      return standing.kept;
  }
};

export const stopWatching: ContextChatEffect = {
  type: 'watch-expiry',
  expiresAt: null,
};
