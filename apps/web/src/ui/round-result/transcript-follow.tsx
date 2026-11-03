'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

const NEAR_BOTTOM_PX = 24;

/** Whether a scroller is close enough to its end to keep following new lines. */
export const isFollowing = (box: {
  readonly scrollTop: number;
  readonly clientHeight: number;
  readonly scrollHeight: number;
}): boolean =>
  box.scrollHeight - box.scrollTop - box.clientHeight <= NEAR_BOTTOM_PX;

type Scroller = {
  scrollTop: number;
  readonly clientHeight: number;
  readonly scrollHeight: number;
};

/**
 * Whether new lines are followed: the one home of that fact. A move up is the
 * reader's signal, and it is read wherever following is decided, so a render or
 * resize before the scroll event arrives never snaps them back. Moving down keeps
 * following on but does not turn it on: only reaching the end does.
 */
export function createFollow() {
  let following = true;
  let lastTop = 0;
  const listeners = new Set<() => void>();
  const set = (next: boolean) => {
    if (next === following) return;
    following = next;
    for (const listener of listeners) listener();
  };
  const observe = (box: Scroller) => {
    // A hidden panel has no position to read: it opens again from the top.
    if (box.clientHeight === 0) {
      lastTop = 0;
      return;
    }
    set(isFollowing(box) || (following && box.scrollTop >= lastTop));
    lastTop = box.scrollTop;
  };
  return {
    following: () => following,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    scrolled: observe,
    resume: () => set(true),
    pin(box: Scroller) {
      observe(box);
      if (!following) return;
      box.scrollTop = box.scrollHeight;
      lastTop = box.scrollTop;
    },
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
    if (scroller.current) follow.pin(scroller.current);
  }, [children, following, follow]);
  // A hidden panel cannot scroll: returning to it lands on the latest line.
  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const observer = new ResizeObserver(() => follow.pin(node));
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
        className="min-h-0 flex-1 overflow-y-auto px-4 pb-4"
      >
        {children}
      </div>
      {following ? null : (
        <button
          type="button"
          onClick={() => {
            // This button goes away with the click, so focus moves to the lines.
            scroller.current?.focus();
            follow.resume();
          }}
          className="absolute right-4 bottom-3 h-room-target cursor-pointer rounded-round border border-border-strong bg-surface-raised px-4 text-sm font-strong shadow-2"
        >
          Latest
        </button>
      )}
    </div>
  );
}
