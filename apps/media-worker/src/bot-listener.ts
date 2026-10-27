import { createAppError } from '@daisy/errors';
import type { BotListenerClient } from '@daisy/media/bot-listener';
import {
  ACTIVITY_RELAY_INTERVAL_MS,
  activityWanted,
  createActivityRelay,
  relayActivity,
} from './bot-listener-relay';
import type { PeerAudioFrame, PeerAudioInput } from './peer-audio';
import { contained } from './speaking-grant';
import { createTrackClocks } from './track-clocks';

const LEASE_MS = 15000;
const RENEW_EVERY_MS = 5000;
/** In a bot cross-ex the segment, seats and grants are read as often as capture reads its history. */
const READ_WANTED_MS = 200;
/** Otherwise only often enough to notice cross-ex starting. */
const READ_IDLE_MS = 1000;

type Read = Awaited<ReturnType<BotListenerClient['read']>>;
type TrackClocks = ReturnType<typeof createTrackClocks>;

/** A peer frame timed on the listener's own calibration, kept only while that seat holds the floor. */
function timedFrame(current: Read, clocks: TrackClocks, raw: PeerAudioFrame) {
  const { state, calibration } = current;
  const segment = state.segment;
  if (!segment || !activityWanted(state)) return null;
  const peer = state.participants.find((p) => p.identity === raw.identity);
  if (!peer) return null;
  const window = clocks.observe(raw, calibration);
  if (!window) return null;
  const { beforeMs, afterMs } = window;
  if (!contained(state, peer.roundParticipantId, { beforeMs, afterMs }))
    return null;
  return {
    seat: peer.roundParticipantId,
    segmentId: segment.id,
    original: {
      sequence: raw.sequence,
      beforeMs: raw.beforeMs,
      afterMs: raw.afterMs,
    },
    frame: { trackId: raw.trackId, pcm: raw.pcm, beforeMs, afterMs },
  };
}

/**
 * The bot listener (ISSUE-764): its own role, lease and routes. It hears the
 * session through the named peer-audio input only, never capture's session
 * or types, and while a bot may speak in cross-examination it relays each
 * frame of a seat holding the floor, timed on its own calibration, for the
 * bot's turn-taking. A cast without a bot debater (frozen at launch) leaves
 * it idle for the session. Activity is a heuristic: the caller treats any
 * failure here as the listener's own, never capture's.
 */
export async function runBotListener(
  input: {
    readonly client: Pick<BotListenerClient, 'lease' | 'read' | 'activity'>;
    readonly audio: PeerAudioInput;
    readonly nowMs: () => number;
    readonly waitUntilMs: (due: number, signal: AbortSignal) => Promise<void>;
  },
  signal: AbortSignal,
) {
  const { epoch } = await input.client.lease(LEASE_MS, signal);
  let current: Read = await input.client.read(epoch, signal);
  if (!current.state.participants.some((p) => p.kind === 'bot'))
    return { relayedBatches: 0, idle: true };
  const clocks = createTrackClocks();
  const relay = createActivityRelay();
  const stopHearing = input.audio.read({
    frame: (raw) => {
      const frame = timedFrame(current, clocks, raw);
      if (frame) relay.observe(frame);
    },
    closed: (trackId) => {
      clocks.close(trackId);
    },
  });
  let relayedBatches = 0;
  let renewAt = input.nowMs() + RENEW_EVERY_MS;
  let readAt = input.nowMs() + READ_WANTED_MS;
  try {
    while (!signal.aborted) {
      const now = input.nowMs();
      const due = now + ACTIVITY_RELAY_INTERVAL_MS;
      if (now >= renewAt) {
        const renewed = await input.client.lease(LEASE_MS, signal, epoch);
        if (renewed.epoch !== epoch)
          throw createAppError('CONFLICT', 'Bot listener epoch changed');
        renewAt = now + RENEW_EVERY_MS;
      }
      if (now >= readAt) {
        current = await input.client.read(epoch, signal);
        clocks.refresh(current.calibration);
        readAt =
          now + (activityWanted(current.state) ? READ_WANTED_MS : READ_IDLE_MS);
      }
      if (activityWanted(current.state))
        relayedBatches += await relayActivity(
          input.client,
          epoch,
          relay.take(),
          signal,
        );
      else relay.clear();
      await input.waitUntilMs(due, signal).catch(() => undefined);
    }
  } finally {
    stopHearing();
    relay.clear();
    clocks.clear();
  }
  return { relayedBatches, idle: false };
}

const RESUME_FIRST_MS = 1000;
const RESUME_MAX_MS = 30000;

/**
 * Keeps the bot listener running for as long as capture does: a failed run
 * (a held or stale lease, a closed session, a refused read) waits and claims
 * again, doubling the wait up to 30 s, so one fault never silences the bot
 * for the session and a closed session is not retried every second. An idle
 * run (no bot debater) ends it.
 */
export async function keepListening(
  input: {
    readonly run: (signal: AbortSignal) => Promise<{ readonly idle: boolean }>;
    readonly nowMs: () => number;
    readonly waitUntilMs: (due: number, signal: AbortSignal) => Promise<void>;
  },
  signal: AbortSignal,
) {
  let pauseMs = RESUME_FIRST_MS;
  while (!signal.aborted) {
    try {
      if ((await input.run(signal)).idle) return;
      pauseMs = RESUME_FIRST_MS;
    } catch {
      if (signal.aborted) return;
      await input
        .waitUntilMs(input.nowMs() + pauseMs, signal)
        .catch(() => undefined);
      pauseMs = Math.min(pauseMs * 2, RESUME_MAX_MS);
    }
  }
}
