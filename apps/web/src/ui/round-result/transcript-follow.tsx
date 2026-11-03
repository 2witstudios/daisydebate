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

type Scroller = {
  scrollTop: number;
  readonly clientHeight: number;
  readonly scrollHeight: number;
};

/**
 * Whether new lines are followed, current before any re-render: a resize in the
 * frame a reader scrolled up must not snap them back to the latest line.
 */
export function createFollow() {
  let following = true;
  return {
    scrolled: (box: Scroller) => (following = isFollowing(box)),
    resume: () => (following = true),
    pin(box: Scroller) {
      if (following) box.scrollTop = box.scrollHeight;
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
  const [following, setFollowing] = useState(true);
  const [follow] = useState(createFollow);
  useLayoutEffect(() => {
    if (scroller.current) follow.pin(scroller.current);
  }, [children, following, follow]);
  // A hidden panel cannot scroll: returning to it lands on the latest line.
  useEffect(() => {
    const node = scroller.current;
    if (!node || !following) return;
    const observer = new ResizeObserver(() => follow.pin(node));
    observer.observe(node);
    return () => observer.disconnect();
  }, [following, follow]);
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        tabIndex={0}
        aria-label="Transcript lines"
        role="group"
        onScroll={(event) => setFollowing(follow.scrolled(event.currentTarget))}
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
            setFollowing(follow.resume());
          }}
          className="absolute right-4 bottom-3 h-room-target cursor-pointer rounded-round border border-border-strong bg-surface-raised px-4 text-sm font-strong shadow-2"
        >
          Latest
        </button>
      )}
    </div>
  );
}
