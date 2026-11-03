'use client';
import type { BroadcastStream, SpectatorTimeline } from '@daisy/protocol';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { broadcastDocumentStale } from '../../features/spectating/browser-policy';
import { sideLabel } from './spectator-timeline-copy';
import { StreamVideo } from './stream-video';

/** Longer than an ordinary rebuffer: past this the last frame is stale, not paused. */
const STALL_SLATE_MS = 5000;
/** Long enough to read, when playback crossed a stretch without stalling first. */
const JUMP_SLATE_MS = 4000;

/**
 * Covers the video while it has nothing current to show. It reads the video alone, so
 * it works with the web tier gone: the feed is on object storage and this page is loaded.
 */
const useInterruptionSlate = (video: RefObject<HTMLVideoElement | null>) => {
  const [shown, setShown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => {
    const element = video.current;
    if (!element) return undefined;
    const stalled = () => {
      clear();
      timer.current = setTimeout(() => setShown(true), STALL_SLATE_MS);
    };
    const moving = () => {
      clear();
      setShown(false);
    };
    element.addEventListener('waiting', stalled);
    element.addEventListener('playing', moving);
    return () => {
      clear();
      element.removeEventListener('waiting', stalled);
      element.removeEventListener('playing', moving);
    };
  }, [video]);
  const jumped = () => {
    clear();
    setShown(true);
    timer.current = setTimeout(() => setShown(false), JUMP_SLATE_MS);
  };
  return { shown, jumped };
};

/** Hides the last frame, so a viewer never reads it as what is happening now. */
export function InterruptionSlate() {
  return (
    <div
      role="status"
      data-testid="broadcast-interruption-slate"
      className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-xl bg-surface-stage text-center text-ink-on-media"
    >
      <span className="font-strong">The broadcast is interrupted</span>
      <span className="text-sm">
        It picks up here by itself. Part of the debate may not be shown.
      </span>
    </div>
  );
}

export type BroadcastPlayerProps = {
  readonly stream: BroadcastStream;
  /** Ranked only (DEC-301): the snapshot carries none on any other Round. */
  readonly captions: SpectatorTimeline['captions'];
  readonly onFinished: () => void;
  readonly onFailed: () => void;
};

/**
 * A Broadcast on the one player. Captions are the released snapshot's latest line,
 * beneath the video where they cover nothing.
 */
export function BroadcastPlayer({
  stream,
  captions,
  onFinished,
  onFailed,
}: BroadcastPlayerProps) {
  const [showCaptions, setShowCaptions] = useState(true);
  const caption = captions.at(-1);
  const video = useRef<HTMLVideoElement>(null);
  const slate = useInterruptionSlate(video);
  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <StreamVideo
          stream={stream}
          label="Broadcast of this debate"
          surface="broadcast_playback"
          autoPlay
          documentStale={broadcastDocumentStale}
          videoRef={video}
          onFinished={onFinished}
          onFailed={onFailed}
          onCaptureJump={slate.jumped}
        />
        {slate.shown ? <InterruptionSlate /> : null}
      </div>
      {showCaptions && caption ? (
        <p
          data-testid="broadcast-caption"
          aria-hidden="true"
          className="rounded-md bg-surface-stage px-3 py-2 text-center text-base text-ink-on-media"
        >
          {`${sideLabel[caption.side]}: ${caption.text}`}
        </p>
      ) : null}
      {captions.length > 0 ? (
        <button
          type="button"
          aria-pressed={showCaptions}
          onClick={() => setShowCaptions((shown) => !shown)}
          className="self-start text-sm font-strong"
        >
          Captions
        </button>
      ) : null}
    </div>
  );
}
