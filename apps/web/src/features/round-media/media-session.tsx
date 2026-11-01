'use client';
import { selectMediaAccount } from './account-signout-cleanup';
import { subscribeMediaRecovery } from './media-recovery-events';
import { createMediaRequest } from './request-media';
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
  type MediaConnectionState,
} from './media-controller';
import { MediaStage } from './media-stage';
import {
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
import { useResumeLifetime } from '../rooms/use-resume-lifetime';
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
const requestMedia = createMediaRequest({
  fetch: (...args) => fetch(...args),
  scheduleDeadline: (expire) => {
    const timer = window.setTimeout(expire, 10_000);
    return () => window.clearTimeout(timer);
  },
});

const nativeMediaNotice = (
  <noscript>
    Live camera and sound require JavaScript. Round controls and judge forms
    remain available.
  </noscript>
);

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
  const [soundBlocked, setSoundBlocked] = useState(false);
  const actualMicrophoneMuted =
    tracks.find((track) => track.local && track.source === 'microphone')
      ?.muted ?? microphoneMuted;
  const [ownIdentity, setOwnIdentity] = useState<string | null>(null);
  const controller = useRef<ReturnType<typeof createMediaController> | null>(
    null,
  );
  const ownership = useResumeLifetime(actorId ?? null, view.id, () =>
    controller.current?.stop(),
  );
  const sound = useRef<(() => Promise<void>) | null>(null);
  const refresh = useRef(onRefresh);
  useEffect(() => {
    refresh.current = onRefresh;
  }, [onRefresh]);
  /** The restore must precede the transport so one truth reaches both. */
  const restoreMute = useRef(poi);
  useEffect(() => {
    selectMediaAccount(actorId ?? null);
    const prior =
      (poi ? readMutePreference(actorId ?? null, view.id) : null) ?? poi;
    if (prior !== restoreMute.current) {
      restoreMute.current = prior;
      muted.current = prior;
      setMicrophoneMuted(prior);
    }
  }, [view.id, actorId, poi]);
  useEffect(() => {
    if (actorId && ownership.owns !== true) return;
    const mounted = createMediaController({
      roundId: view.id,
      api: {
        admit: (id, signal) => requestMedia(id, 'session', signal),
        reconcile: (id, signal) => requestMedia(id, 'reconcile', signal),
      },
      changed: setConnection,
      refresh: () => refresh.current(),
      recovery: {
        schedule: (fire, ms) => window.setTimeout(fire, ms),
        cancel: (handle) => window.clearTimeout(handle as number),
      },
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
              [source, error.kind] as SourceIllHealth,
            ]),
          sourceHealthy: (source) => {
            setIllHealth((current) =>
              current.filter(([held]) => held !== source),
            );
            setMissing((current) => current.filter((held) => held !== source));
          },
          tracks: setTracks,
          playbackChanged: (allowed) => setSoundBlocked(!allowed),
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
    const stopRecoveryEvents = subscribeMediaRecovery({
      online: window,
      visibility: document,
      isVisible: () => document.visibilityState === 'visible',
      nudge: () => {
        void mounted.nudge();
      },
    });
    controller.current = mounted;
    void mounted.join();
    return () => {
      stopRecoveryEvents();
      mounted.stop();
      controller.current = null;
      sound.current = null;
      microphone.current = null;
    };
  }, [view.id, view.roomId, actorId, ownership.owns]);
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
  }, [view, actorId]);
  /** The controls read this device's own capture truth as a named input. */
  useEffect(() => {
    const captured = tracks
      .filter((track) => track.local && track.source === 'microphone')
      .map((track) => track.source);
    reportLocalPublication(
      `${view.id}:${actorId ?? 'anonymous'}`,
      actorId && ownership.owns !== true
        ? null
        : localPublicationOf({
            connection,
            grants: media?.grants.publish,
            captured,
            muted: actualMicrophoneMuted,
          }),
    );
  }, [
    view.id,
    actorId,
    connection,
    media,
    tracks,
    actualMicrophoneMuted,
    ownership.owns,
  ]);
  useEffect(
    () => () =>
      reportLocalPublication(`${view.id}:${actorId ?? 'anonymous'}`, null),
    [view.id, actorId],
  );
  const status = mediaStatus(connection, missing, {
    illHealth,
    microphone: {
      granted: media?.grants.publish.includes('microphone') ?? null,
      published: tracks.some(
        (track) => track.local && track.source === 'microphone',
      ),
      muted: actualMicrophoneMuted,
    },
    sound: { blocked: soundBlocked },
  });
  if (actorId && ownership.owns !== true)
    return (
      <section aria-label="Live camera and sound">
        <p role="status">
          {ownership.owns === false
            ? 'This Round is open in another tab.'
            : 'Checking this Round’s tab…'}
        </p>
        {ownership.owns === false ? (
          <button type="button" onClick={ownership.takeOver}>
            Use this tab
          </button>
        ) : null}
        {nativeMediaNotice}
      </section>
    );
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
                .then(() => setSoundBlocked(false))
                .catch(() => setSoundBlocked(true));
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
      {nativeMediaNotice}
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
