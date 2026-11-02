'use client';
import '../../ui/debate-room/zod-jitless';
import { readCheckedDevices } from '../video/device-selection';
import { createRoundViewFollower } from './follow-round-view';
import { roundTimeMediaClock } from './schedule-deadline';
import { systemScheduler } from '../realtime/browser-adapters';
import type { RoundTime } from '../round-runtime/round-time';
import { useEffect, useRef, useState } from 'react';
import type { RoundMediaState, RoundView } from '@daisy/protocol';
import {
  createBrowserMediaTransport,
  type MediaTrack,
  type Source,
} from './browser-transport';
import {
  createMediaController,
  type MediaConnectionState,
} from './media-controller';
import {
  createMediaRequest,
  MEDIA_READ_BUDGET_MS,
  MEDIA_RETRY_DELAYS_MS,
} from './request-media';
import { MediaStage } from './media-stage';
import {
  hasLiveTracks,
  mediaStatus,
  retryMissingDevices,
  showConnection,
} from './media-status';
import { hasOpenQuestioning } from '@daisy/debate-engine';

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((done) => {
    const timer = setTimeout(done, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        done();
      },
      { once: true },
    );
  });
const requestMedia = createMediaRequest({
  fetch: (url, options) => fetch(url, options),
  scheduleDeadline: (expire, ms) => {
    const timer = setTimeout(expire, ms);
    return () => clearTimeout(timer);
  },
});

/** Mount once per Round; changing projections never resets command or media lifetimes. */
function RoundMediaSession({
  view,
  onRefresh,
  roundTime,
}: {
  readonly view: RoundView;
  readonly onRefresh: () => void;
  readonly roundTime: RoundTime;
}) {
  const poi = view.ladderId === null && hasOpenQuestioning(view.rules);
  const [microphoneMuted, setMicrophoneMuted] = useState(poi);
  const [changingMicrophone, setChangingMicrophone] = useState(false);
  const muted = useRef(poi);
  const microphone = useRef<((value: boolean) => Promise<void>) | null>(null);
  const [connection, setConnection] =
    useState<MediaConnectionState>('connecting');
  const [media, setMedia] = useState<RoundMediaState | null>(null);
  const [microphoneConfirmed, setMicrophoneConfirmed] = useState(true);
  const [tracks, setTracks] = useState<readonly MediaTrack[]>([]);
  /** Checked devices found gone; the transport keeps running (ISSUE-573). */
  const [missing, setMissing] = useState<readonly Source[]>([]);
  const controller = useRef<ReturnType<typeof createMediaController> | null>(
    null,
  );
  const sound = useRef<(() => Promise<void>) | null>(null);
  /** The latest accepted version, read when a Round mount's controller starts. */
  const acceptedVersion = useRef(view.version);
  const refresh = useRef(onRefresh);
  useEffect(() => {
    refresh.current = onRefresh;
  }, [onRefresh]);
  const [clock] = useState(() =>
    roundTimeMediaClock({ roundTime, scheduler: systemScheduler }),
  );
  /** Once per mount: it remembers which deadline has already refreshed. */
  const follower = useRef<ReturnType<typeof createRoundViewFollower> | null>(
    null,
  );
  useEffect(() => {
    const mounted = createMediaController({
      roundId: view.id,
      initialRoundViewVersion: acceptedVersion.current,
      api: {
        admit: (id, signal) => requestMedia(id, 'session', signal),
        reconcile: (id, signal) => requestMedia(id, 'reconcile', signal),
      },
      changed: showConnection({ connection: setConnection, media: setMedia }),
      received: (state) => {
        setMedia(state);
        setMicrophoneConfirmed(true);
      },
      superseded: () => setMicrophoneConfirmed(false),
      retry: { delaysMs: MEDIA_RETRY_DELAYS_MS, wait: pause },
      readBudget: {
        // Monotonic: read age is elapsed time, and a clock step must not skew it.
        now: () => performance.now(),
        ms: MEDIA_READ_BUDGET_MS,
        at: (ms, fire) => {
          const timer = setTimeout(fire, ms);
          return () => clearTimeout(timer);
        },
      },
      transport: () => {
        const browser = createBrowserMediaTransport({
          microphoneMuted: muted.current,
          devices: readCheckedDevices(view.roomId),
          missing: (source) =>
            setMissing((current) =>
              current.includes(source) ? current : [...current, source],
            ),
          tracks: setTracks,
          invalidated: () => {
            refresh.current();
            void mounted.reconcile({ kind: 'wake' });
          },
          reconnect: () => {
            refresh.current();
            void mounted.reconnect();
          },
        });
        sound.current = browser.startAudio;
        microphone.current = browser.setMicrophoneMuted;
        return browser.transport;
      },
    });
    controller.current = mounted;
    void mounted.join();
    return () => {
      mounted.stop();
      controller.current = null;
      sound.current = null;
      microphone.current = null;
    };
  }, [view.id, view.roomId]);
  useEffect(() => {
    if (controller.current?.state() === 'ended') return;
    if (view.status === 'completed' || view.status === 'abandoned') {
      controller.current?.stop();
      return;
    }
    acceptedVersion.current = view.version;
    follower.current ??= createRoundViewFollower({
      clock,
      reconcile: (event) => void controller.current?.reconcile(event),
      refresh: () => refresh.current(),
    });
    return follower.current(view);
  }, [view, clock]);
  const status = mediaStatus(connection, missing);
  return (
    <section aria-label="Live camera and sound">
      <MediaStage
        connection={connection}
        view={view}
        media={media}
        microphoneConfirmed={microphoneConfirmed}
        tracks={tracks}
      />
      <div className="flex flex-wrap items-center gap-3 bg-surface-sunken px-3 py-2">
        <p role="status" className="m-0 text-sm text-ink-muted">
          {status.message}
        </p>
        {hasLiveTracks(connection) ? (
          <button
            type="button"
            className="min-h-room-target rounded-md border border-border px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
            onClick={() => {
              void sound.current?.().catch(() => {
                controller.current?.deviceFailed();
                setConnection('device-blocked');
              });
            }}
          >
            Enable sound
          </button>
        ) : null}
        {poi && media?.grants.publish.includes('camera') ? (
          <button
            type="button"
            className="min-h-room-target rounded-md border border-border px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
            disabled={
              !hasLiveTracks(connection) ||
              changingMicrophone ||
              !media.grants.publish.includes('microphone')
            }
            aria-pressed={!microphoneMuted}
            onClick={async () => {
              const previous = muted.current;
              muted.current = !previous;
              setChangingMicrophone(true);
              try {
                await microphone.current?.(!previous);
                setMicrophoneMuted(!previous);
              } catch {
                muted.current = previous;
                controller.current?.deviceFailed();
                setConnection('device-blocked');
              } finally {
                setChangingMicrophone(false);
              }
            }}
          >
            {microphoneMuted ? 'Unmute microphone' : 'Mute microphone'}
          </button>
        ) : null}
        {status.retry ? (
          <button
            type="button"
            className="min-h-room-target rounded-md border border-border px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
            onClick={() => {
              setMissing(retryMissingDevices(view.roomId, missing));
              refresh.current();
              void controller.current?.reconnect();
            }}
          >
            Retry camera and sound
          </button>
        ) : null}
      </div>
      <noscript>
        Live camera and sound require JavaScript. Round controls and judge forms
        remain available.
      </noscript>
    </section>
  );
}

export const roundMediaSlot = (onRefresh: () => void, roundTime: RoundTime) =>
  function RoundMediaSlot(view: RoundView) {
    return (
      <RoundMediaSession
        key={view.id}
        view={view}
        onRefresh={onRefresh}
        roundTime={roundTime}
      />
    );
  };
