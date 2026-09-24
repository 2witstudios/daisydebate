import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { ENVELOPE_VERSION } from '@daisy/protocol';
import { createConnectionStore, type Scheduler } from './connection-store';

setupRitewayBun();

/**
 * A scheduler where every `setTimeout` fires no earlier than the next
 * multiple of `throttleMs`, simulating Chromium's coalescing of a hidden
 * tab's chained timers to about once a minute (ADR 0031 §7). `now()` still
 * reports real elapsed time correctly whenever a callback actually runs.
 */
function createThrottledScheduler(
  throttleMs: number,
): Scheduler & { advance(ms: number): void } {
  let clock = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; cb: () => void }>();
  return {
    now: () => clock,
    setTimeout(cb, ms) {
      const id = nextId++;
      const at = Math.ceil((clock + ms) / throttleMs) * throttleMs;
      timers.set(id, { at, cb });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id as number);
    },
    advance(ms: number) {
      const target = clock + ms;
      while (true) {
        const due = [...timers.entries()]
          .filter(([, t]) => t.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, t] = due;
        timers.delete(id);
        clock = t.at;
        t.cb();
      }
      clock = target;
    },
  };
}

type Listener = (event: { type: string; [key: string]: unknown }) => void;

/** A fake server that answers every `ping` with a `pong` at once. */
class AlwaysPongSocket {
  readyState = 0;
  closedWith: { code?: number; reason?: string } | null = null;
  private listeners: Record<string, Listener[]> = {};
  addEventListener(type: string, listener: Listener) {
    (this.listeners[type] ??= []).push(listener);
  }
  send(data: string) {
    const message: unknown = JSON.parse(data);
    if (
      typeof message === 'object' &&
      message !== null &&
      Reflect.get(message, 'type') === 'ping'
    ) {
      this.emit('message', {
        type: 'message',
        data: JSON.stringify({
          v: ENVELOPE_VERSION,
          type: 'pong',
          id: Reflect.get(message, 'id'),
        }),
      });
    }
  }
  close(code?: number, reason?: string) {
    if (this.closedWith) return;
    const resolvedCode = code ?? 1000;
    this.closedWith = { code: resolvedCode, reason: reason ?? '' };
    this.readyState = 3;
    this.emit('close', { type: 'close', code: resolvedCode, reason: '' });
  }
  open() {
    this.readyState = 1;
    this.emit('open', { type: 'open' });
  }
  message(data: unknown) {
    this.emit('message', { type: 'message', data: JSON.stringify(data) });
  }
  private emit(type: string, event: { type: string; [key: string]: unknown }) {
    for (const listener of this.listeners[type] ?? []) listener(event);
  }
}

describe('heartbeat under a throttled hidden tab (ADR 0031 §7)', () => {
  test('a server that answers every ping never gets reaped, even when ticks fire ~60s late', async () => {
    const scheduler = createThrottledScheduler(60_000);
    let sock: AlwaysPongSocket | undefined;
    const store = createConnectionStore({
      url: 'wss://realtime.test/ws',
      createSocket: () => {
        sock = new AlwaysPongSocket();
        return sock;
      },
      scheduler,
      fetchTicket: async () => 'a'.repeat(43),
      random: () => 0.5,
      onVisibilityChange: () => () => {},
    });

    store.connect();
    sock!.open();
    await Promise.resolve();
    await Promise.resolve();
    sock!.message({ v: ENVELOPE_VERSION, type: 'ready' });

    scheduler.advance(10 * 60_000);

    assert({
      given:
        'a scheduler that coalesces every timer to once-a-minute boundaries (well past the 15s heartbeat period), and a server that answers every ping at once',
      should: 'never judge the healthy socket dead over 10 simulated minutes',
      actual: sock!.closedWith,
      expected: null,
    });
  });

  test('negative control: a server that never answers is still judged dead under the same throttled schedule', async () => {
    const scheduler = createThrottledScheduler(60_000);
    // A reconnect after death creates a second socket; capture the first
    // one specifically so a later reconnect can't hide a real reap.
    const sockets: AlwaysPongSocket[] = [];
    const store = createConnectionStore({
      url: 'wss://realtime.test/ws',
      createSocket: () => {
        const sock = new AlwaysPongSocket();
        sock.send = () => {}; // silent: never answers a ping.
        sockets.push(sock);
        return sock;
      },
      scheduler,
      fetchTicket: async () => 'a'.repeat(43),
      random: () => 0.5,
      onVisibilityChange: () => () => {},
    });
    const firstSocket = () => sockets[0]!;

    store.connect();
    firstSocket().open();
    await Promise.resolve();
    await Promise.resolve();
    firstSocket().message({ v: ENVELOPE_VERSION, type: 'ready' });

    scheduler.advance(10 * 60_000);

    assert({
      given: 'the same throttled schedule but a server that never answers',
      should:
        'still judge the first socket dead (proving the rule is exercised, not vacuous)',
      actual: firstSocket().closedWith !== null,
      expected: true,
    });
  });
});
