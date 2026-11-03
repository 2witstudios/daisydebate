'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  followNext,
  initialFollow,
  type FollowEvent,
  type ScrollPosition,
} from './transcript-follow-state';

type Scroller = ScrollPosition & { scrollTop: number };

/** The thin store around the pure decision: it alone writes the position. */
function createFollow() {
  let state = initialFollow;
  const listeners = new Set<() => void>();
  const apply = (event: FollowEvent, box: Scroller | null) => {
    const wasFollowing = state.following;
    const next = followNext(state, event);
    state = next.state;
    if (next.pinToEnd && box) {
      box.scrollTop = box.scrollHeight;
      state = followNext(state, { type: 'pinned', top: box.scrollTop }).state;
    }
    if (state.following !== wasFollowing)
      for (const listener of listeners) listener();
  };
  return {
    following: () => state.following,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    scrolled: (box: Scroller) =>
      apply({ type: 'scrolled', position: box }, box),
    /** Reads layout only while following: a reader back in the lines costs nothing. */
    changed(box: Scroller) {
      if (state.following) apply({ type: 'changed', position: box }, box);
    },
    latest: (box: Scroller | null) => apply({ type: 'latest' }, box),
  };
}

/**
 * Keeps new lines in view until the reader scrolls up to read something, then
 * stays put and offers the way back to the latest line.
 */
export function TranscriptFollow({
  children,
}: {
  readonly children: ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [follow] = useState(createFollow);
  const following = useSyncExternalStore(
    follow.subscribe,
    follow.following,
    () => true,
  );
  useLayoutEffect(() => {
    if (scroller.current) follow.changed(scroller.current);
  }, [children, follow]);
  // A resize moves the end, and a panel shown again has one to return to.
  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const observer = new ResizeObserver(() => follow.changed(node));
    observer.observe(node);
    return () => observer.disconnect();
  }, [follow]);
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        tabIndex={0}
        aria-label="Transcript lines"
        role="group"
        onScroll={(event) => follow.scrolled(event.currentTarget)}
        className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 overflow-anchor-none"
      >
        {children}
      </div>
      {following ? null : (
        <button
          type="button"
          onClick={() => {
            // This button goes away with the click, so focus moves to the lines.
            scroller.current?.focus();
            follow.latest(scroller.current);
          }}
          className="absolute right-4 bottom-3 h-room-target cursor-pointer rounded-round border border-border-strong bg-surface-raised px-4 text-sm font-strong shadow-2"
        >
          Latest
        </button>
      )}
    </div>
  );
}
