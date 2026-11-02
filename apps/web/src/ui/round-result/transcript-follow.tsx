'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
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
  const [following, setFollowing] = useState(true);
  useLayoutEffect(() => {
    const node = scroller.current;
    if (node && following) node.scrollTop = node.scrollHeight;
  }, [children, following]);
  // A hidden panel cannot scroll: returning to it lands on the latest line.
  useEffect(() => {
    const node = scroller.current;
    if (!node || !following) return;
    const observer = new ResizeObserver(() => {
      node.scrollTop = node.scrollHeight;
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [following]);
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        tabIndex={0}
        aria-label="Transcript lines"
        role="group"
        onScroll={(event) => setFollowing(isFollowing(event.currentTarget))}
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
            setFollowing(true);
          }}
          className="absolute right-4 bottom-3 h-room-target cursor-pointer rounded-round border border-border-strong bg-surface-raised px-4 text-sm font-strong shadow-2"
        >
          Latest
        </button>
      )}
    </div>
  );
}
