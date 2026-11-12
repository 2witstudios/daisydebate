'use client';
import '../../lib/zod-jitless';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { isRoundOver, type RoundView } from '@daisy/protocol';
import { postRoundCallChosen } from '../post-round-call/offered';
import { hasOpenQuestioning } from '@daisy/debate-engine';
import { selectMediaAccount } from './account-signout-cleanup';
import { subscribeBrowserPageEvents } from './adapters/browser-page-events';
import { createLiveKitRoom, RESUME_BUDGET_MS } from './adapters/livekit-room';
import { createRoundViewFollower } from './follow-round-view';
import { MediaBar } from './media-bar';
import {
  clearMutePreference,
  readMutePreference,
  writeMutePreference,
} from './media-preferences';
import { createMediaRuntime } from './media-runtime';
import { MediaStage } from './media-stage';
import { initialMediaState, type MediaPolicy } from './model/media-state';
import {
  publicationOf,
  type LocalPublication,
} from './model/media-publication';
import { stageOf, tabOf } from './model/media-status';
import {
  createMediaRequest,
  MEDIA_READ_BUDGET_MS,
  MEDIA_RETRY_DELAYS_MS,
} from './request-media';

import { roundTimeMediaClock } from './schedule-deadline';
import { systemScheduler } from '../realtime/browser-adapters';
import type { RoundTime } from '../round-runtime/round-time';
import { TabElsewhere } from '../rooms/tab-elsewhere';
import {
  clearCheckedDevices,
  forgetCheckedDevices,
  readCheckedDevices,
} from '../video/device-selection';

const MEDIA_POLICY: MediaPolicy = {
  requestRetryDelaysMs: MEDIA_RETRY_DELAYS_MS,
  readBudgetMs: MEDIA_READ_BUDGET_MS,
  resumeBudgetMs: RESUME_BUDGET_MS,

  /** A prompt may stay open indefinitely; the connection does not wait for it. */
  capturePatienceMs: 3_000,
  recoveryDelaysMs: [1_000, 2_000, 4_000, 8_000, 10_000],
  eventFloorMs: 5_000,
};

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

/** Whether this tab may hold the Round's media; rooms owns the coordination. */
export type RoundMediaTab = {
  readonly owns: boolean | null;
  readonly takeOver: () => void;
  /** The session registers how to release local tracks synchronously. */
  readonly onStepDown: (release: () => void) => () => void;
};

type SessionInput = {
  readonly onRefresh: () => void;
  readonly roundTime: RoundTime;
  /** The signed-in member whose device choices are restored (ISSUE-879). */
  readonly actorId: string;
  readonly tab: RoundMediaTab;
  readonly onPublication?: (value: LocalPublication) => void;
  /** Another account was here before: its owner clears what it kept. */
  readonly onAccountChanged: () => void;
  /** The server ended a post-round call: its room gives way to the result. */
  readonly onCallEnded?: () => void;
};

/** Mount once per Round; changing projections never resets command or media lifetimes. */
function RoundMediaSession({
  view,
  onRefresh,
  roundTime,
  actorId,
  tab,
  onPublication,
  onAccountChanged,
  onCallEnded,
}: SessionInput & { readonly view: RoundView }) {
  const { owns, onStepDown } = tab;
  const questioning = view.ladderId === null && hasOpenQuestioning(view.rules);
  const refresh = useRef(onRefresh);
  useEffect(() => {
    refresh.current = onRefresh;
  }, [onRefresh]);
  const [runtime] = useState(() =>
    createMediaRuntime({
      roundId: view.id,
      initial: initialMediaState({
        roundViewVersion: view.version,
        microphoneMuted: questioning,
      }),
      policy: MEDIA_POLICY,
      // Monotonic: elapsed time, and a clock step must not skew it.
      now: () => performance.now(),
      at: (ms, fire) => {
        const timer = setTimeout(fire, ms);
        return () => clearTimeout(timer);
      },
      api: {
        admit: (id, signal) => requestMedia(id, 'session', signal),
        reconcile: (id, signal) => requestMedia(id, 'reconcile', signal),
      },
      openRoom: (hooks) =>
        createLiveKitRoom({
          ...hooks,
          checkedDevices: () =>
            readCheckedDevices(view.roomId, undefined, actorId),
        }),
      refreshView: () => refresh.current(),
      mute: {
        remember: (muted) => writeMutePreference(actorId, view.id, muted),
        forget: () => clearMutePreference(actorId, view.id),
      },
      devices: {
        forget: (sources) =>
          forgetCheckedDevices(view.roomId, sources, undefined, actorId),
        clear: () => clearCheckedDevices(view.roomId, undefined, actorId),
      },
    }),
  );
  const state = useSyncExternalStore(
    runtime.subscribe,
    runtime.state,
    runtime.state,
  );
  const handles = useSyncExternalStore(
    runtime.subscribe,
    runtime.handles,
    runtime.handles,
  );
  const { dispatch } = runtime;
  useEffect(
    () => onStepDown(() => dispatch({ type: 'tab-changed', owns: false })),
    [dispatch, onStepDown],
  );
  /** The restore must precede the first claim so one truth reaches the transport. */
  useEffect(() => {
    if (selectMediaAccount(actorId)) onAccountChanged();
    if (!questioning) return;
    const prior = readMutePreference(actorId, view.id);
    if (prior !== null) dispatch({ type: 'mute-restored', muted: prior });
  }, [view.id, actorId, questioning, onAccountChanged, dispatch]);
  useEffect(() => {
    dispatch({ type: 'tab-changed', owns });
    return () => dispatch({ type: 'tab-changed', owns: null });
  }, [dispatch, owns]);
  useEffect(
    () =>
      subscribeBrowserPageEvents({
        online: window,
        visibility: document,
        isVisible: () => document.visibilityState === 'visible',
        nudge: () => dispatch({ type: 'browser-nudged' }),
        page: window,
        leaving: () => dispatch({ type: 'page-left' }),
        restored: () => dispatch({ type: 'frozen-page-restored' }),
      }),
    [dispatch],
  );
  const [clock] = useState(() =>
    roundTimeMediaClock({ roundTime, scheduler: systemScheduler }),
  );
  /** Once per mount: it remembers which deadline has already refreshed. */
  const follower = useRef<ReturnType<typeof createRoundViewFollower> | null>(
    null,
  );
  useEffect(() => {
    // A post-round call outlives its Round: the server's own answer ends it.
    if (isRoundOver(view.status) && !postRoundCallChosen(view)) {
      dispatch({ type: 'round-ended' });
      return;
    }
    follower.current ??= createRoundViewFollower({
      clock,
      reconcile: (read) => dispatch({ type: 'read-requested', read }),
      refresh: () => refresh.current(),
    });
    return follower.current(view);
  }, [view, clock, dispatch]);
  /** Only the server knows a call ended early: everyone left, or it never opened. */
  const callEnded = useRef(onCallEnded);
  useEffect(() => {
    callEnded.current = onCallEnded;
  }, [onCallEnded]);
  const endedCall = postRoundCallChosen(view) && state.link.phase === 'ended';
  useEffect(() => {
    if (endedCall) callEnded.current?.();
  }, [endedCall]);
  /** The controls read this device's own capture truth as a named input. */
  const report = useRef(onPublication);
  useEffect(() => {
    report.current = onPublication;
  }, [onPublication]);
  const publication = publicationOf(state);
  useEffect(() => report.current?.(publication), [publication]);
  useEffect(() => () => report.current?.(null), []);
  const presence = tabOf(state);
  if (presence !== 'owned')
    return (
      <section aria-label="Live camera and sound">
        {presence === 'elsewhere' ? (
          <TabElsewhere takeOver={tab.takeOver} />
        ) : (
          <p role="status">Checking this Round’s tab…</p>
        )}
        {nativeMediaNotice}
      </section>
    );
  const stage = stageOf(state);
  return (
    <section aria-label="Live camera and sound">
      <MediaStage
        view={view}
        media={stage.media}
        microphoneConfirmed={stage.microphoneConfirmed}
        tracks={stage.tracks}
        handles={handles}
        connection={stage.connection}
        ownIdentity={stage.ownIdentity}
        ownMuted={stage.ownMuted}
        remotePeers={stage.remotePeers}
      />
      <MediaBar
        state={state}
        dispatch={dispatch}
        // Anyone on a post-round call may mute themselves.
        questioning={questioning || postRoundCallChosen(view)}
      />
      {nativeMediaNotice}
    </section>
  );
}

export const roundMediaSlot = (input: SessionInput) =>
  function RoundMediaSlot(view: RoundView) {
    // Another account is another session: nothing in this one may carry over.
    return (
      <RoundMediaSession
        key={`${view.id}:${input.actorId}`}
        view={view}
        {...input}
      />
    );
  };
