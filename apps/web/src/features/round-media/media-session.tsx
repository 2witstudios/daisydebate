'use client';
import '../../ui/debate-room/zod-jitless';
import { readCheckedDevices } from '../video/device-selection';
import { nextMediaRefreshAt } from './refresh-deadline';
import { scheduleMediaDeadline } from './schedule-deadline';
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
  mediaFailure,
  transientMediaFailure,
  type MediaConnectionState,
} from './media-controller';
import { MediaStage } from './media-stage';
import { mediaStatus, retryMissingDevices } from './media-status';
import { hasOpenQuestioning } from '@daisy/debate-engine';

/** Backoff for an admission refused for now, about 3.5 s in all (ISSUE-494). */
const ADMISSION_RETRY_MS = [500, 1000, 2000];
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
const requestMedia = async (
  roundId: string,
  operation: 'session' | 'reconcile',
  signal: AbortSignal,
) => {
  let response: Response;
  try {
    response = await fetch(
      `/api/rounds/${encodeURIComponent(roundId)}/media/${operation}`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal,
        cache: 'no-store',
      },
    );
  } catch (error) {
    // The network, not the server, failed; a cancelled request stays final.
    if (signal.aborted) throw error;
    throw transientMediaFailure();
  }
  if (!response.ok) throw mediaFailure(response.status);
  return response.json() as Promise<unknown>;
};

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
  const [tracks, setTracks] = useState<readonly MediaTrack[]>([]);
  /** Checked devices found gone; the transport keeps running (ISSUE-573). */
  const [missing, setMissing] = useState<readonly Source[]>([]);
  const controller = useRef<ReturnType<typeof createMediaController> | null>(
    null,
  );
  const sound = useRef<(() => Promise<void>) | null>(null);
  const refresh = useRef(onRefresh);
  useEffect(() => {
    refresh.current = onRefresh;
  }, [onRefresh]);
  useEffect(() => {
    const mounted = createMediaController({
      roundId: view.id,
      api: {
        admit: (id, signal) => requestMedia(id, 'session', signal),
        reconcile: (id, signal) => requestMedia(id, 'reconcile', signal),
      },
      changed: setConnection,
      received: setMedia,
      retry: { delaysMs: ADMISSION_RETRY_MS, wait: pause },
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
            void mounted.reconcile();
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
    void controller.current?.reconcile();
    const next = nextMediaRefreshAt(view);
    if (next === null) return;
    return scheduleMediaDeadline({
      deadlineMs: next,
      roundTime,
      scheduler: systemScheduler,
      refresh: () => {
        refresh.current();
        void controller.current?.reconcile();
      },
    });
  }, [view, roundTime]);
  const status = mediaStatus(connection, missing);
  return (
    <section aria-label="Live camera and sound">
      <MediaStage view={view} media={media} tracks={tracks} />
      <div className="flex flex-wrap items-center gap-3 bg-surface-sunken px-3 py-2">
        <p role="status" className="m-0 text-sm text-ink-muted">
          {status.message}
        </p>
        {connection === 'live' ? (
          <button
            type="button"
            className="min-h-room-target rounded-md border border-border px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
            onClick={() => {
              void sound
                .current?.()
                .catch(() => setConnection('device-blocked'));
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
              connection !== 'live' ||
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
