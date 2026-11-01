'use client';
import '../../ui/debate-room/zod-jitless';
import { systemClock } from '@daisy/clock';
import { readCheckedDevices } from '../video/device-selection';
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
import {
  classifySourceFailure,
  mediaStatus,
  retryMissingDevices,
  type SourceIllHealth,
} from './media-status';
import { hasOpenQuestioning } from '@daisy/debate-engine';

import {
  clearMutePreference,
  readMutePreference,
  writeMutePreference,
} from './media-preferences';
import {
  claimOwnership,
  heartbeatOwnership,
  mayResumeTab,
  readOwnership,
  resumeOwnershipHeartbeatMs,
  subscribeOwnership,
  tabIdOf,
} from '../rooms/resume-ownership';
import {
  localPublicationOf,
  reportLocalPublication,
} from './local-publication';

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
  const timeoutSignal =
    typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
      ? (AbortSignal as { timeout: (ms: number) => AbortSignal }).timeout(10000)
      : null;
  const requestSignal =
    timeoutSignal && typeof AbortSignal !== 'undefined' && 'any' in AbortSignal
      ? (AbortSignal as { any: (s: AbortSignal[]) => AbortSignal }).any([
          signal,
          timeoutSignal,
        ])
      : signal;
  try {
    response = await fetch(
      `/api/rounds/${encodeURIComponent(roundId)}/media/${operation}`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: requestSignal,
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
  actorId,
}: {
  readonly view: RoundView;
  readonly onRefresh: () => void;
  /** The signed-in member whose device choices are restored (ISSUE-879). */
  readonly actorId?: string | null | undefined;
}) {
  const poi = view.ladderId === null && hasOpenQuestioning(view.rules);
  /**
   * One mute truth: the same value reaches the UI and the transport. A saved
   * preference (this principal in this Round) applies once the browser
   * document exists, before the transport is created; the server default
   * stands otherwise (ISSUE-879).
   */
  const [microphoneMuted, setMicrophoneMuted] = useState(poi);
  const muted = useRef(poi);
  const setMuted = (value: boolean) => {
    muted.current = value;
    restoreMute.current = value;
    setMicrophoneMuted(value);
  };
  const [changingMicrophone, setChangingMicrophone] = useState(false);
  const microphone = useRef<((value: boolean) => Promise<void>) | null>(null);
  const [connection, setConnection] =
    useState<MediaConnectionState>('connecting');
  const [media, setMedia] = useState<RoundMediaState | null>(null);
  const [tracks, setTracks] = useState<readonly MediaTrack[]>([]);
  /** Checked devices found gone; the transport keeps running (ISSUE-573). */
  const [missing, setMissing] = useState<readonly Source[]>([]);
  /** Per-source ill health: reported, not swallowed (ISSUE-817/829). */
  const [illHealth, setIllHealth] = useState<readonly SourceIllHealth[]>([]);
  const [ownIdentity, setOwnIdentity] = useState<string | null>(null);
  const controller = useRef<ReturnType<typeof createMediaController> | null>(
    null,
  );
  const sound = useRef<(() => Promise<void>) | null>(null);
  const refresh = useRef(onRefresh);
  useEffect(() => {
    refresh.current = onRefresh;
  }, [onRefresh]);
  /** The restore must precede the transport so one truth reaches both. */
  const restoreMute = useRef(poi);
  useEffect(() => {
    const prior = readMutePreference(actorId ?? null, view.id);
    if (prior !== null && prior !== restoreMute.current) {
      restoreMute.current = prior;
      muted.current = prior;
      setMicrophoneMuted(prior);
    }
  }, [view.id, actorId]);
  useEffect(() => {
    const mounted = createMediaController({
      roundId: view.id,
      api: {
        admit: (id, signal) => requestMedia(id, 'session', signal),
        reconcile: (id, signal) => requestMedia(id, 'reconcile', signal),
      },
      changed: setConnection,
      received: setMedia,
      admitted: (admission) => setOwnIdentity(admission.identity),
      retry: { delaysMs: ADMISSION_RETRY_MS, wait: pause },
      transport: () => {
        const browser = createBrowserMediaTransport({
          microphoneMuted: muted.current,
          devices: readCheckedDevices(view.roomId, undefined, actorId ?? null),
          missing: (source) =>
            setMissing((current) =>
              current.includes(source) ? current : [...current, source],
            ),
          sourceFailed: (source, error) =>
            setIllHealth((current) => [
              ...current.filter(([held]) => held !== source),
              [source, classifySourceFailure(error)] as SourceIllHealth,
            ]),
          sourceHealthy: (source) =>
            setIllHealth((current) =>
              current.filter(([held]) => held !== source),
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
      clearMutePreference(actorId ?? null, view.id);
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
  /** The controls read this device's own capture truth as a named input. */
  useEffect(() => {
    const captured = tracks
      .filter((track) => track.local && track.source === 'microphone')
      .map((track) => track.source);
    reportLocalPublication(
      actorId ?? 'anonymous',
      localPublicationOf({
        connection,
        grants: media?.grants.publish,
        captured,
        muted: microphoneMuted,
      }),
    );
  }, [actorId, connection, media, tracks, microphoneMuted]);
  /**
   * While this tab publishes, it owns the Round's advisory resume claim and
   * heartbeats it, so no other tab treats this one as stale and takes over.
   * If another tab does take the claim over, this tab's media stops rather
   * than publish beside it (ISSUE-879; advisory only, never authority).
   */
  useEffect(() => {
    if (actorId === null || actorId === undefined) return;
    if (connection !== 'live') return;
    const session = window.sessionStorage;
    const storage = window.localStorage;
    const tabId = tabIdOf(
      session,
      () =>
        window.crypto?.randomUUID?.() ??
        `tab-${Date.parse(systemClock.now())}-advisory-no-secret`,
    );
    const held = readOwnership(storage, actorId, view.id);
    const verdict = mayResumeTab(tabId, held, Date.parse(systemClock.now()));
    // A fresh foreign owner means this tab joined late: it keeps its media
    // (the server grants govern) but never claims the resume for itself.
    if (verdict !== 'defer')
      claimOwnership({
        storage,
        actorId,
        roundId: view.id,
        tabId,
        nowMs: Date.parse(systemClock.now()),
      });
    const beat = () =>
      heartbeatOwnership({
        storage,
        actorId,
        roundId: view.id,
        tabId,
        nowMs: Date.parse(systemClock.now()),
      });
    const heartbeat = window.setInterval(beat, resumeOwnershipHeartbeatMs);
    const unsubscribe = subscribeOwnership(window, actorId, view.id, () => {
      const owner = readOwnership(storage, actorId, view.id).owner;
      if (owner !== null && owner !== tabId) controller.current?.stop();
    });
    return () => {
      window.clearInterval(heartbeat);
      unsubscribe();
    };
  }, [actorId, view.id, connection]);
  /**
   * Online and visibility are nudges only: the controller owns its recovery
   * attempts and backoff across every state change, so a nudge restarts work
   * only from the one paused state (ISSUE-880).
   */
  useEffect(() => {
    const recover = () => {
      const ctrl = controller.current;
      if (ctrl?.state() !== 'unavailable') return;
      void ctrl.reconnect();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') recover();
    };
    window.addEventListener('online', recover);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('online', recover);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const status = mediaStatus(connection, missing, illHealth, {
    granted: media?.grants.publish.includes('microphone') ?? null,
    published: tracks.some(
      (track) => track.local && track.source === 'microphone',
    ),
    muted: microphoneMuted,
  });
  return (
    <section aria-label="Live camera and sound">
      <MediaStage
        view={view}
        media={media}
        tracks={tracks}
        connection={connection}
        ownIdentity={ownIdentity}
        ownMuted={microphoneMuted}
      />
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
              const next = !previous;
              muted.current = next;
              setChangingMicrophone(true);
              try {
                await microphone.current?.(next);
                setMuted(next);
                writeMutePreference(actorId ?? null, view.id, next);
              } catch {
                setMuted(previous);
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
              setMissing(
                retryMissingDevices(view.roomId, missing, actorId ?? null),
              );
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

export const roundMediaSlot = (
  onRefresh: () => void,
  actorId?: string | null,
) =>
  function RoundMediaSlot(view: RoundView) {
    return (
      <RoundMediaSession
        key={view.id}
        view={view}
        onRefresh={onRefresh}
        actorId={actorId}
      />
    );
  };
