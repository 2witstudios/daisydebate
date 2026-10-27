import { createAppError } from '@daisy/errors';
import type { BotListenerClient } from '@daisy/media/bot-listener';
import { createCaptureClock } from '@daisy/media/observation';
import {
  ACTIVITY_RELAY_INTERVAL_MS,
  activityWanted,
  createActivityRelay,
  relayActivity,
} from './bot-listener-relay';
import type { PeerAudioFrame, PeerAudioInput } from './peer-audio';

const LEASE_MS = 15000;
const RENEW_EVERY_MS = 5000;
/** The segment, seats and calibration are read about as often as capture reads its history. */
const READ_EVERY_MS = 200;

type Read = Awaited<ReturnType<BotListenerClient['read']>>;

/**
 * The bot listener (ISSUE-764): its own role, lease and routes. It hears the
 * session through the named peer-audio input only, never capture's session
 * or types, and while a bot may speak in cross-examination it relays each
 * seat's frames, timed on its own calibration, for the bot's turn-taking.
 * Activity is a heuristic: the caller treats any failure here as the
 * listener's own, never capture's.
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
  const clocks = new Map<string, ReturnType<typeof createCaptureClock>>();
  const relay = createActivityRelay();
  const hear = (raw: PeerAudioFrame) => {
    const { state, calibration } = current;
    const segment = state.segment;
    if (!segment || segment.endedAt !== null || !activityWanted(state)) return;
    const peer = state.participants.find((p) => p.identity === raw.identity);
    if (!peer) return;
    let clock = clocks.get(raw.trackId);
    if (!clock) {
      clock = createCaptureClock(calibration);
      clocks.set(raw.trackId, clock);
    }
    const window = clock.observe(raw);
    if (!window) return;
    relay.observe({
      seat: peer.roundParticipantId,
      segmentId: segment.id,
      original: {
        sequence: raw.sequence,
        beforeMs: raw.beforeMs,
        afterMs: raw.afterMs,
      },
      frame: {
        trackId: raw.trackId,
        pcm: raw.pcm,
        beforeMs: Math.floor(window.beforeMs),
        afterMs: Math.ceil(window.afterMs),
      },
    });
  };
  const stopHearing = input.audio.read(hear);
  let relayedBatches = 0;
  let renewAt = input.nowMs() + RENEW_EVERY_MS;
  let readAt = input.nowMs() + READ_EVERY_MS;
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
        for (const clock of clocks.values()) clock.refresh(current.calibration);
        readAt = now + READ_EVERY_MS;
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
  return { relayedBatches };
}

const RESUME_AFTER_MS = 1000;

/**
 * Keeps the bot listener running for as long as capture does: a failed run
 * (a held or stale lease, a refused read) pauses briefly and claims again, so
 * one fault never silences the bot for the rest of the session.
 */
export async function keepListening(
  input: {
    readonly run: (signal: AbortSignal) => Promise<unknown>;
    readonly nowMs: () => number;
    readonly waitUntilMs: (due: number, signal: AbortSignal) => Promise<void>;
  },
  signal: AbortSignal,
) {
  while (!signal.aborted) {
    try {
      await input.run(signal);
    } catch {
      if (signal.aborted) return;
      await input
        .waitUntilMs(input.nowMs() + RESUME_AFTER_MS, signal)
        .catch(() => undefined);
    }
  }
}
