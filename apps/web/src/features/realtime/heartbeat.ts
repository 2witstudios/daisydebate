import { ENVELOPE_VERSION, heartbeatMs } from '@daisy/protocol';
import type { Scheduler } from './connection-types';

const HEARTBEAT_DEAD_AFTER_MS = heartbeatMs * 2;
type Send = (text: string) => void;

/**
 * Tracks the id and deadline of the *earliest* outstanding (unanswered)
 * ping, or null when it has already been answered (or none has been sent
 * yet). Judging death by this — the age of the oldest unanswered ping —
 * rather than by elapsed time since the tick last happened to run is what
 * keeps a throttled hidden tab from declaring a healthy socket dead: a ping
 * that gets answered promptly clears this before the next (possibly late)
 * tick ever checks it, so a late tick just sends a fresh ping and waits.
 *
 * Only a `pong` whose `id` matches this one clears it (ADR 0031 §7: "the
 * client sends ping every 15s and expects pong" with the same id), and
 * nothing may push the deadline later once it is set: an extra ping (the
 * visibilitychange nudge) is still sent on the wire, but never starts or
 * extends tracking while an earlier ping is still outstanding — otherwise
 * repeated visibility changes could defer detecting a truly dead socket
 * forever.
 */
export function createHeartbeat({
  scheduler,
  onDead,
}: {
  readonly scheduler: Scheduler;
  readonly onDead: () => void;
}) {
  let outstandingId: string | null = null;
  let deadline: number | null = null;
  let counter = 0;
  let timer: unknown = null;
  const ping = (id: string) =>
    JSON.stringify({ v: ENVELOPE_VERSION, type: 'ping', id });
  function track(id: string) {
    outstandingId = id;
    deadline = scheduler.now() + HEARTBEAT_DEAD_AFTER_MS;
  }
  function stop() {
    if (timer !== null) scheduler.clearTimeout(timer);
    timer = null;
    outstandingId = null;
    deadline = null;
  }
  /**
   * Sends a fresh ping known to be the only one in flight and starts
   * tracking its deadline. Tracking is set before the socket send so that a
   * synchronously-delivered pong (real sockets never are, but a test double
   * may be) still clears it rather than being overwritten afterward.
   */
  function fresh(live: () => boolean, send: Send) {
    counter += 1;
    const id = `ping-${counter}`;
    track(id);
    if (live()) send(ping(id));
  }
  function schedule(live: () => boolean, send: Send) {
    timer = scheduler.setTimeout(() => {
      if (!live()) return;
      // The overdue ping was given its own deadline at send time, so this
      // fires only when the server truly failed to answer it — never merely
      // because this tick itself ran late.
      if (deadline !== null && scheduler.now() >= deadline) {
        onDead();
        return;
      }
      // A tick that finds a ping still outstanding but not overdue waits.
      if (deadline === null) fresh(live, send);
      schedule(live, send);
    }, heartbeatMs);
  }
  return {
    start(live: () => boolean, send: Send) {
      stop();
      fresh(live, send);
      schedule(live, send);
    },
    stop,
    /** The visibilitychange nudge (ADR 0031 §7) never extends a live deadline. */
    visibility(send: Send) {
      counter += 1;
      const id = `ping-${counter}`;
      send(ping(id));
      if (outstandingId === null) track(id);
    },
    pong(id: string) {
      if (id !== outstandingId) return;
      outstandingId = null;
      deadline = null;
    },
  };
}
