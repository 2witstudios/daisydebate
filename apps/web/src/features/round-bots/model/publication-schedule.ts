/** Authorization timing comes from the audio schedule, never from promise readiness. */
type PublicationSchedule = {
  readonly audio:
    | { readonly status: 'known'; readonly endsAtMs: number | null }
    | {
        readonly status: 'starting';
        readonly endsAtMs: number | null;
        readonly waiting: string | null;
      };
  readonly authorized: readonly string[];
};
export type ScheduleEvent =
  | { readonly type: 'starting' | 'finished' | 'discard' }
  | {
      readonly type: 'scheduled';
      readonly endsAtMs: number;
      readonly nowMs: number;
    }
  | {
      readonly type: 'prepare';
      readonly phraseId: string;
      readonly joined: boolean;
      readonly nowMs: number;
    }
  | { readonly type: 'consume'; readonly phraseId: string };
export type Authorization = {
  readonly type: 'authorize';
  readonly phraseId: string;
  readonly startsInMs: number;
};
export const emptyPublicationSchedule = (): PublicationSchedule => ({
  audio: { status: 'known', endsAtMs: null },
  authorized: [],
});
export function nextPublicationSchedule(
  state: PublicationSchedule,
  event: ScheduleEvent,
): {
  readonly state: PublicationSchedule;
  readonly effects: readonly Authorization[];
} {
  switch (event.type) {
    case 'starting':
      return {
        state: {
          ...state,
          audio: {
            status: 'starting',
            endsAtMs: state.audio.endsAtMs,
            waiting: null,
          },
        },
        effects: [],
      };
    case 'finished':
      return {
        state: {
          ...state,
          audio: { status: 'known', endsAtMs: state.audio.endsAtMs },
        },
        effects: [],
      };
    case 'discard':
      return { state: { ...state, authorized: [] }, effects: [] };
    case 'consume':
      return {
        state: {
          ...state,
          authorized: state.authorized.filter((id) => id !== event.phraseId),
        },
        effects: [],
      };
    case 'prepare': {
      if (state.authorized.includes(event.phraseId))
        return { state, effects: [] };
      if (state.audio.status === 'starting')
        return {
          state: {
            ...state,
            audio: { ...state.audio, waiting: event.phraseId },
          },
          effects: [],
        };
      if (!event.joined) return { state, effects: [] };
      return {
        state: { ...state, authorized: [...state.authorized, event.phraseId] },
        effects: [
          {
            type: 'authorize',
            phraseId: event.phraseId,
            startsInMs: Math.max(
              0,
              Math.round((state.audio.endsAtMs ?? event.nowMs) - event.nowMs),
            ),
          },
        ],
      };
    }
    case 'scheduled': {
      const next: PublicationSchedule = {
        ...state,
        audio: { status: 'known', endsAtMs: event.endsAtMs },
      };
      return state.audio.status === 'starting' && state.audio.waiting !== null
        ? nextPublicationSchedule(next, {
            type: 'prepare',
            phraseId: state.audio.waiting,
            joined: true,
            nowMs: event.nowMs,
          })
        : { state: next, effects: [] };
    }
  }
}
