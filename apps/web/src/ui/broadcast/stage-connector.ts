import {
  stageConnectionIdle,
  stageConnectionOn,
  stageLinkOf,
  type StageConnection,
  type StageConnectionEvent,
  type StageRoomHandle,
} from './stage-connection';
import type { StageLink } from './stage-view';

/**
 * Runs the connection: one connect at a time, every failure an event rather than a
 * rejection, every disconnect's own failure swallowed (the room is let go either way).
 */
export function createStageConnection<R extends StageRoomHandle>(resources: {
  readonly createRoom: () => R;
  readonly onLink: (link: StageLink) => void;
}) {
  let state: StageConnection<R> = stageConnectionIdle;
  let link = stageLinkOf(state);
  const on = (event: StageConnectionEvent<R>) => {
    const step = stageConnectionOn(state, event);
    state = step.state;
    for (const effect of step.effects)
      void effect.room.disconnect().catch(() => undefined);
    const next = stageLinkOf(state);
    if (next === link) return;
    link = next;
    resources.onLink(next);
  };
  return {
    on,
    /** Joins the offered room unless the stage already holds or has closed one. */
    offer: async (room: { readonly url: string; readonly token: string }) => {
      if (state.kind !== 'idle') return;
      const joining = resources.createRoom();
      on({ type: 'join', room: joining });
      try {
        await joining.connect(room.url, room.token);
      } catch {
        // Unreachable, refused or timed out: the next read offers the room again.
        on({ type: 'failed', room: joining });
        return;
      }
      on({ type: 'joined', room: joining });
    },
    /**
     * The room reports it disconnected; true when it was the joined room, whose tiles
     * then go. A room already let go may report late and owns nothing on the stage.
     */
    dropped: (room: R): boolean => {
      const held = state.kind === 'joined' && state.room === room;
      on({ type: 'dropped', room });
      return held;
    },
    joinedRoom: (): R | null => (state.kind === 'joined' ? state.room : null),
    close: () => on({ type: 'close' }),
  };
}
