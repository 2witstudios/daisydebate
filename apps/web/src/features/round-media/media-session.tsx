'use client';
import { selectMediaAccount } from './account-signout-cleanup';
import { subscribeMediaRecovery } from './media-recovery-events';
import {
  createMediaRecovery,
  MEDIA_RECOVERY_DELAYS_MS,
  MEDIA_RECOVERY_EVENT_FLOOR_MS,
} from './media-recovery';
import {
  createMediaRequest,
  MEDIA_READ_BUDGET_MS,
  MEDIA_RETRY_DELAYS_MS,
} from './request-media';
import { createRoundViewFollower } from './follow-round-view';
import type { MediaFailureKind } from './media-failure';
import '../../ui/debate-room/zod-jitless';
import {
  clearCheckedDevices,
  readCheckedDevices,
} from '../video/device-selection';
import { roundTimeMediaClock } from './schedule-deadline';
import { systemScheduler } from '../realtime/browser-adapters';
import type { RoundTime } from '../round-runtime/round-time';
import { useEffect, useRef, useState } from 'react';
import type { RoundMediaState, RoundView } from '@daisy/protocol';
import {
  createBrowserMediaTransport,
  type MediaTrack,
  type RemotePeer,
  type Source,
} from './browser-transport';
import {
  createMediaController,
  type MediaConnectionState,
} from './media-controller';
import { MediaStage } from './media-stage';
import {
  hasLiveTracks,
  mediaStatus,
  retryMissingDevices,
  retryUsesDefaults,
  showConnection,
  type SourceIllHealth,
} from './media-status';
import { hasOpenQuestioning } from '@daisy/debate-engine';

import {
  clearMutePreference,
  readMutePreference,
  writeMutePreference,
} from './media-preferences';
import { TabElsewhere } from '../rooms/tab-elsewhere';
import { localPublicationOf, type LocalPublication } from './local-publication';

/** A prompt may stay open indefinitely; the connection does not wait for it. */
const CAPTURE_PATIENCE_MS = 3_000;
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
  roundTime,
  actorId,
  tab,
  onPublication,
  onAccountChanged,
}: {
  readonly view: RoundView;
  readonly onRefresh: () => void;
  readonly roundTime: RoundTime;
  /** The signed-in member whose device choices are restored (ISSUE-879). */
  readonly actorId?: string | null | undefined;
  readonly tab?: RoundMediaTab | undefined;
  readonly onPublication?: ((value: LocalPublication) => void) | undefined;
  /** Another account was here before: its owner clears what it kept. */
  readonly onAccountChanged: () => void;
}) {
  // Absent for a viewer with no seat to coordinate; such a mount never gates.
  const owns = tab ? tab.owns : true;
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
  /** Why the connection is unavailable, as the controller reported it. */
  const [failure, setFailure] = useState<MediaFailureKind | null>(null);
  const [media, setMedia] = useState<RoundMediaState | null>(null);
  const [microphoneConfirmed, setMicrophoneConfirmed] = useState(true);
  const [tracks, setTracks] = useState<readonly MediaTrack[]>([]);
  const [remotePeers, setRemotePeers] = useState<readonly RemotePeer[]>([]);
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
  const defaultChoices = useRef(false);
  const onStepDown = tab?.onStepDown;
  useEffect(() => onStepDown?.(() => controller.current?.stop()), [onStepDown]);
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
  /** The restore must precede the transport so one truth reaches both. */
  const restoreMute = useRef(poi);
  useEffect(() => {
    if (selectMediaAccount(actorId ?? null)) onAccountChanged();
    const prior =
      (poi ? readMutePreference(actorId ?? null, view.id) : null) ?? poi;
    if (prior !== restoreMute.current) {
      restoreMute.current = prior;
      muted.current = prior;
      setMicrophoneMuted(prior);
    }
  }, [view.id, actorId, poi, onAccountChanged]);
  useEffect(() => {
    if (owns !== true) return;
    const show = showConnection<RoundMediaState>({
      connection: setConnection,
      media: setMedia,
    });
    const recovery = createMediaRecovery({
      delaysMs: MEDIA_RECOVERY_DELAYS_MS,
      eventFloorMs: MEDIA_RECOVERY_EVENT_FLOOR_MS,
      now: () => performance.now(),
      schedule: (fire, ms) => {
        const timer = window.setTimeout(fire, ms);
        return () => window.clearTimeout(timer);
      },
      rejoin: () => void mounted.reconnect(),
      wake: () => void mounted.reconcile({ kind: 'wake' }),
      refresh: () => refresh.current(),
    });
    const mounted = createMediaController({
      roundId: view.id,
      initialRoundViewVersion: acceptedVersion.current,
      api: {
        admit: (id, signal) => requestMedia(id, 'session', signal),
        reconcile: (id, signal) => requestMedia(id, 'reconcile', signal),
      },
      changed: (state, why) => {
        show(state);
        setFailure(why ?? null);
        recovery.changed(state, why);
      },
      received: (state) => {
        setMedia(state);
        setMicrophoneConfirmed(true);
      },
      superseded: () => setMicrophoneConfirmed(false),
      admitted: (admission) => setOwnIdentity(admission.identity),
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
        setIllHealth([]);
        setMissing([]);
        const browser = createBrowserMediaTransport({
          microphoneMuted: muted.current,
          capturePatience: (expired) => {
            const timer = window.setTimeout(expired, CAPTURE_PATIENCE_MS);
            return () => window.clearTimeout(timer);
          },
          sourceWaiting: (source) =>
            setIllHealth((current) =>
              current.some(([held]) => held === source)
                ? current
                : [...current, [source, 'waiting']],
            ),
          checkedDevices: () =>
            defaultChoices.current
              ? { state: 'available', choices: {} }
              : readCheckedDevices(view.roomId, undefined, actorId ?? null),
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
          remotePeers: setRemotePeers,
          playbackChanged: (allowed) => setSoundBlocked(!allowed),
          microphoneChanged: (value) => {
            setMuted(value);
            writeMutePreference(actorId ?? null, view.id, value);
          },
          invalidated: () => {
            refresh.current();
            void mounted.reconcile({ kind: 'wake' });
          },
          reconnect: () => {
            refresh.current();
            mounted.dropped();
          },
          replaced: () => mounted.replaced(),
        });
        sound.current = browser.startAudio;
        microphone.current = browser.setMicrophoneMuted;
        setChangingMicrophone(false);
        setSoundBlocked(false);
        return browser.transport;
      },
    });
    const stopRecoveryEvents = subscribeMediaRecovery({
      online: window,
      visibility: document,
      isVisible: () => document.visibilityState === 'visible',
      nudge: recovery.nudge,
      page: window,
      leaving: mounted.stop,
      restored: () => {
        refresh.current();
        void mounted.reconcile({ kind: 'wake' });
      },
    });
    controller.current = mounted;
    void mounted.join();
    return () => {
      stopRecoveryEvents();
      recovery.stop();
      mounted.stop();
      controller.current = null;
      sound.current = null;
      microphone.current = null;
    };
  }, [view.id, view.roomId, actorId, owns]);
  useEffect(() => {
    if (controller.current?.state() === 'ended') return;
    if (view.status === 'completed' || view.status === 'abandoned') {
      controller.current?.stop();
      clearMutePreference(actorId ?? null, view.id);
      return;
    }
    acceptedVersion.current = view.version;
    follower.current ??= createRoundViewFollower({
      clock,
      reconcile: (event) => void controller.current?.reconcile(event),
      refresh: () => refresh.current(),
    });
    return follower.current(view);
  }, [view, actorId, clock]);
  /** The controls read this device's own capture truth as a named input. */
  const report = useRef(onPublication);
  useEffect(() => {
    report.current = onPublication;
  }, [onPublication]);
  useEffect(() => {
    const captured = tracks
      .filter((track) => track.local && track.source === 'microphone')
      .map((track) => track.source);
    report.current?.(
      owns === true
        ? localPublicationOf({
            connection,
            failure,
            grants: media?.grants.publish,
            captured,
            muted: actualMicrophoneMuted,
          })
        : null,
    );
  }, [connection, failure, media, tracks, actualMicrophoneMuted, owns]);
  useEffect(() => () => report.current?.(null), []);
  const status = mediaStatus(connection, missing, {
    failure,
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
  if (owns !== true)
    return (
      <section aria-label="Live camera and sound">
        {owns === false ? (
          <TabElsewhere takeOver={tab!.takeOver} />
        ) : (
          <p role="status">Checking this Round’s tab…</p>
        )}
        {nativeMediaNotice}
      </section>
    );
  return (
    <section aria-label="Live camera and sound">
      <MediaStage
        view={view}
        media={media}
        microphoneConfirmed={microphoneConfirmed}
        tracks={tracks}
        connection={connection}
        ownIdentity={ownIdentity}
        ownMuted={microphoneMuted}
        remotePeers={remotePeers}
      />
      <div
        data-room-media="status"
        className="flex flex-wrap items-center gap-3 bg-surface-sunken px-3 py-2"
      >
        <p role="status" className="m-0 text-sm text-ink-muted">
          {status.message}
        </p>
        {hasLiveTracks(connection) ? (
          <button
            type="button"
            className="min-h-room-target rounded-md border border-border px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
            onClick={() => {
              // The current transport reports the typed outcome; retired promises cannot change this UI.
              void sound.current?.().catch(() => undefined);
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
              const apply = microphone.current;
              if (!apply) return;
              const next = !muted.current;
              setChangingMicrophone(true);
              try {
                await apply(next);
              } catch {
                // Failure is reported by the source owner, only while it is current.
              } finally {
                if (microphone.current === apply) setChangingMicrophone(false);
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
              if (retryUsesDefaults(illHealth)) {
                defaultChoices.current = true;
                clearCheckedDevices(view.roomId, undefined, actorId ?? null);
              }
              setMissing(
                retryMissingDevices(view.roomId, missing, actorId ?? null),
              );
              refresh.current();
              void controller.current?.retry();
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

/** Whether this tab may hold the Round's media; rooms owns the coordination. */
export type RoundMediaTab = {
  readonly owns: boolean | null;
  readonly takeOver: () => void;
  /** The session registers how to release local tracks synchronously. */
  readonly onStepDown: (release: () => void) => () => void;
};

export const roundMediaSlot = (input: {
  readonly onRefresh: () => void;
  readonly roundTime: RoundTime;
  readonly actorId?: string | null;
  readonly tab?: RoundMediaTab;
  readonly onPublication?: (value: LocalPublication) => void;
  readonly onAccountChanged: () => void;
}) =>
  function RoundMediaSlot(view: RoundView) {
    return (
      <RoundMediaSession
        key={view.id}
        view={view}
        onRefresh={input.onRefresh}
        roundTime={input.roundTime}
        actorId={input.actorId}
        tab={input.tab}
        onPublication={input.onPublication}
        onAccountChanged={input.onAccountChanged}
      />
    );
  };
