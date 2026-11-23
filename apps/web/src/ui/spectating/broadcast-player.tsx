'use client';
import { useElementEvent } from '../edge/use-dom-events';
import { useDelay } from '../edge/use-tick';
import { Announcement } from '../components/announcement/announcement';
import { Button } from '../components/button/button';
import type {
  BroadcastStream,
  SpectatorTimeline,
} from '@daisy/protocol/spectator-timeline';
import { useRef, useState, type RefObject } from 'react';
import { broadcastDocumentStale } from '../../features/spectating/browser-policy';
import { seatLabelIn } from './spectator-timeline-copy';
import { StreamVideo } from './stream-video';

/** Longer than an ordinary rebuffer: past this the last frame is stale, not paused. */
const STALL_SLATE_MS = 5000;
/** Long enough to read, when playback crossed a stretch without stalling first. */
const JUMP_SLATE_MS = 4000;

/**
 * Covers the video while it has nothing current to show. It reads the video alone, so
 * it works with the web tier gone: the feed is on object storage and this page is loaded.
 */
/** A wait that, when it runs out, shows or hides the slate. */
type SlateWait = {
  readonly ms: number;
  readonly shows: boolean;
  /** Each arming is its own wait, so a new one restarts it. */
  readonly armed: number;
};

const useInterruptionSlate = (video: RefObject<HTMLVideoElement | null>) => {
  const [shown, setShown] = useState(false);
  const [wait, setWait] = useState<SlateWait | null>(null);
  const arm = (ms: number, shows: boolean) =>
    setWait((current) => ({ ms, shows, armed: (current?.armed ?? 0) + 1 }));
  useElementEvent(video, 'waiting', () => arm(STALL_SLATE_MS, true));
  useElementEvent(video, 'playing', () => {
    setWait(null);
    setShown(false);
  });
  useDelay(
    () => {
      if (wait === null) return;
      setShown(wait.shows);
      setWait(null);
    },
    wait?.ms ?? null,
    wait?.armed,
  );
  const jumped = () => {
    setShown(true);
    arm(JUMP_SLATE_MS, false);
  };
  return { shown, jumped };
};

/** Hides the last frame, so a viewer never reads it as what is happening now. */
function InterruptionSlate() {
  return (
    <Announcement
      as="div"
      kind="progress"
      data-testid="broadcast-interruption-slate"
      className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-xl bg-surface-stage text-center text-ink-on-media"
    >
      <span className="font-strong">The broadcast is interrupted</span>
      <span className="text-sm">
        It picks up here by itself. Part of the debate may not be shown.
      </span>
    </Announcement>
  );
}

export type BroadcastPlayerProps = {
  readonly stream: BroadcastStream;
  /** Ranked only (DEC-301): the snapshot carries none on any other Round. */
  readonly captions: SpectatorTimeline['captions'];
  /** Who sits where, so a caption reads by its seat's own name. */
  readonly seating: Pick<SpectatorTimeline, 'sides' | 'seats'>;
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
  seating,
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
          {`${seatLabelIn(seating, caption.seat)}: ${caption.text}`}
        </p>
      ) : null}
      {captions.length > 0 ? (
        <Button
          variant="text"
          type="button"
          aria-pressed={showCaptions}
          onClick={() => setShowCaptions((shown) => !shown)}
          className="self-start text-sm"
        >
          Captions
        </Button>
      ) : null}
    </div>
  );
}
