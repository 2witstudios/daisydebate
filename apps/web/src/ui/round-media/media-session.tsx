'use client';
import '../../lib/zod-jitless';
import { browserTransport } from '../edge/browser-request';
import { browserScheduler } from '../edge/browser-time';
import { mediaDeadlineAt } from '../edge/round-media-browser';
import { useDeliver } from '../edge/use-answer';
import { useResource } from '../edge/use-driver';
import { useLeave } from '../edge/use-answer';
import { Announcement } from '../components/announcement/announcement';
import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { isRoundOver } from '@daisy/protocol/round';
import { type RoundView } from '@daisy/protocol/round-view';
import { postRoundCallChosen } from '../../features/post-round-call/offered';
import { hasOpenQuestioning } from '@daisy/debate-engine';
import { selectMediaAccount } from '../../features/round-media/account-signout-cleanup';
import { subscribeBrowserPageEvents } from '../../features/round-media/adapters/browser-page-events';
import {
  createLiveKitRoom,
  RESUME_BUDGET_MS,
} from '../../features/round-media/adapters/livekit-room';
import { createRoundViewFollower } from '../../features/round-media/follow-round-view';
import { MediaBar } from './media-bar';
import {
  clearMutePreference,
  readMutePreference,
  writeMutePreference,
} from '../../features/round-media/media-preferences';
import { createMediaRuntime } from '../../features/round-media/media-runtime';
import { MediaStage } from './media-stage';
import {
  initialMediaState,
  type MediaPolicy,
} from '../../features/round-media/model/media-state';
import {
  publicationOf,
  type LocalPublication,
} from '../../features/round-media/model/media-publication';
import { stageOf, tabOf } from '../../features/round-media/model/media-status';
import {
  createMediaRequest,
  MEDIA_READ_BUDGET_MS,
  MEDIA_RETRY_DELAYS_MS,
} from '../../features/round-media/request-media';

import { roundTimeMediaClock } from '../../features/round-media/schedule-deadline';
import { systemScheduler } from '../edge/realtime-browser';
import type { RoundTime } from '../../features/round-runtime/round-time';
import { TabElsewhere } from '../active-room/tab-elsewhere';
import {
  clearCheckedDevices,
  forgetCheckedDevices,
  readCheckedDevices,
} from '../../features/video/device-selection';

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
  fetch: browserTransport,
  scheduleDeadline: browserScheduler.after,
});

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
  const questioning = view.ladder === null && hasOpenQuestioning(view.rules);
  const muteOffered = questioning || postRoundCallChosen(view);
  // The runtime and the deadline follower outlive a render: each refresh
  // reaches the owner's latest handler.
  const refresh = useRef(onRefresh);
  useDeliver(onRefresh, (latest) => {
    refresh.current = latest;
  });
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
      at: mediaDeadlineAt,
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
  useResource(onStepDown, (register) => ({
    dispose: register(() => dispatch({ type: 'tab-changed', owns: false })),
  }));
  /** The restore must precede the first claim so one truth reaches the transport. */
  const restoring = useMemo(
    () => ({ roundId: view.id, actorId, muteOffered, onAccountChanged }),
    [view.id, actorId, muteOffered, onAccountChanged],
  );
  useDeliver(restoring, (asked) => {
    if (selectMediaAccount(asked.actorId)) asked.onAccountChanged();
    // A post-round call offers mute to everyone, so it restores the choice too.
    if (!asked.muteOffered) return;
    const prior = readMutePreference(asked.actorId, asked.roundId);
    if (prior !== null) dispatch({ type: 'mute-restored', muted: prior });
  });
  useResource(owns, (claimed) => {
    dispatch({ type: 'tab-changed', owns: claimed });
    return { dispose: () => dispatch({ type: 'tab-changed', owns: null }) };
  });
  useResource(dispatch, (send) => ({
    dispose: subscribeBrowserPageEvents({
      online: window,
      visibility: document,
      isVisible: () => document.visibilityState === 'visible',
      nudge: () => send({ type: 'browser-nudged' }),
      page: window,
      leaving: () => send({ type: 'page-left' }),
      restored: () => send({ type: 'frozen-page-restored' }),
    }),
  }));
  const [clock] = useState(() =>
    roundTimeMediaClock({ roundTime, scheduler: systemScheduler }),
  );
  /** Once per mount: it remembers which deadline has already refreshed. */
  const follower = useRef<ReturnType<typeof createRoundViewFollower> | null>(
    null,
  );
  // Each view holds its deadline watch until the next one replaces it.
  useResource(view, (shown) => {
    // A post-round call outlives its Round: the server's own answer ends it.
    if (isRoundOver(shown.status) && !postRoundCallChosen(shown)) {
      dispatch({ type: 'round-ended' });
      return null;
    }
    follower.current ??= createRoundViewFollower({
      clock,
      reconcile: (read) => dispatch({ type: 'read-requested', read }),
      refresh: () => refresh.current(),
    });
    return { dispose: follower.current(shown) };
  });
  /** Only the server knows a call ended early: everyone left, or it never opened. */
  const endedCall = postRoundCallChosen(view) && state.link.phase === 'ended';
  useDeliver(endedCall, (ended) => {
    if (ended) onCallEnded?.();
  });
  /** The controls read this device's own capture truth as a named input. */
  const publication = publicationOf(state);
  useDeliver(publication, (current) => onPublication?.(current));
  useLeave(() => onPublication?.(null));
  const presence = tabOf(state);
  if (presence !== 'owned')
    return (
      <section aria-label="Live camera and sound">
        {presence === 'elsewhere' ? (
          <TabElsewhere takeOver={tab.takeOver} />
        ) : (
          <Announcement as="p" kind="progress">
            Checking this Round’s tab…
          </Announcement>
        )}
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
        questioning={muteOffered}
      />
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
