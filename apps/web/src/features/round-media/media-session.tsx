'use client';
import '../../ui/debate-room/zod-jitless';
import { systemClock } from '@daisy/clock';
import {
  forgetCheckedDevices,
  readCheckedDevices,
} from '../video/device-selection';
import { nextMediaRefreshAt } from './refresh-deadline';
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

const messages: Record<MediaConnectionState, string> = {
  connecting: 'Connecting camera and sound…',
  reconnecting: 'Reconnecting camera and sound…',
  live: 'Connected',
  'device-blocked':
    'Camera or microphone access is blocked. Check your browser permissions, then retry.',
  'device-missing':
    'Your checked camera or microphone is missing. Reconnect it, or retry to use your default device.',
  unavailable: 'Camera and sound are unavailable. Retry to reconnect.',
  ended: 'The call has ended.',
};
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
}: {
  readonly view: RoundView;
  readonly onRefresh: () => void;
}) {
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
        return browser.transport;
      },
    });
    controller.current = mounted;
    void mounted.join();
    return () => {
      mounted.stop();
      controller.current = null;
      sound.current = null;
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
    const timer = window.setTimeout(
      () => {
        refresh.current();
        void controller.current?.reconcile();
      },
      Math.max(0, next - Date.parse(systemClock.now())),
    );
    return () => window.clearTimeout(timer);
  }, [view]);
  return (
    <section aria-label="Live camera and sound">
      <MediaStage view={view} media={media} tracks={tracks} />
      <div className="flex flex-wrap items-center gap-3 bg-surface-sunken px-3 py-2">
        <p role="status" className="m-0 text-sm text-ink-muted">
          {connection === 'live' && missing.length > 0
            ? `Connected, but your checked ${missing.join(' and ')} is missing. Reconnect it, or retry to use your default.`
            : messages[connection]}
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
        {connection === 'unavailable' ||
        connection === 'device-blocked' ||
        connection === 'device-missing' ||
        missing.length > 0 ? (
          <button
            type="button"
            className="min-h-room-target rounded-md border border-border px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
            onClick={() => {
              // An explicit retry uses the default only for the device found gone.
              forgetCheckedDevices(view.roomId, missing);
              setMissing([]);
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

export const roundMediaSlot = (onRefresh: () => void) =>
  function RoundMediaSlot(view: RoundView) {
    return (
      <RoundMediaSession key={view.id} view={view} onRefresh={onRefresh} />
    );
  };
