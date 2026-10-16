import type { ServerMessage } from '@daisy/protocol';
import type { ConnectionState } from '../realtime/connection-types';
import type { Scheduler } from '../realtime/connection-store';
import type { SyncConnection, SyncVisibility } from './driver';

/**
 * Test support: the edges a resource sync driver touches, as fakes the test
 * drives. `log` records connection, read and visibility traffic in order.
 */
export function driverEdges<A>() {
  let now = 1000;
  let timers: { id: number; at: number; run: () => void }[] = [];
  let timerIds = 0;
  const pending: ((answer: A | Error) => void)[] = [];
  let visible = true;
  let onVisible: (() => void) | undefined;
  let emit: (frame: ServerMessage) => void = () => {};
  let connectionListener: ((state: ConnectionState) => void) | undefined;
  const log: string[] = [];
  const scheduler: Scheduler = {
    now: () => now,
    setTimeout: (run, ms) => {
      const id = ++timerIds;
      timers.push({ id, at: now + ms, run });
      return id;
    },
    clearTimeout: (id) => {
      timers = timers.filter((timer) => timer.id !== id);
    },
  };
  const visibility: SyncVisibility = {
    isVisible: () => visible,
    onVisible: (listener) => {
      onVisible = listener;
      return () => {
        onVisible = undefined;
        log.push('visibility released');
      };
    },
  };
  const connection: SyncConnection = {
    subscribeTopic: (topic, listener) => {
      log.push(`subscribe ${topic}`);
      emit = listener;
      return () => log.push('unsubscribe');
    },
    onMessage: () => () => {},
    resubscribeTopic: () => {},
    subscribe: (listener) => {
      connectionListener = listener;
      return () => {};
    },
    connect: () => log.push('connect'),
    close: () => log.push('close'),
  };
  return {
    scheduler,
    visibility,
    connection,
    log,
    read: () =>
      new Promise<A>((resolve, reject) => {
        log.push('read');
        pending.push((answer) =>
          answer instanceof Error ? reject(answer) : resolve(answer),
        );
      }),
    reads: () => log.filter((entry) => entry === 'read').length,
    answer: (answer: A | Error) => pending.shift()?.(answer),
    /** Lets settled reads dispatch their answers. */
    flush: () => new Promise((resolve) => setTimeout(resolve, 0)),
    advance: (ms: number) => {
      now += ms;
      const due = timers.filter((timer) => timer.at <= now);
      timers = timers.filter((timer) => timer.at > now);
      for (const timer of due) timer.run();
    },
    timers: () => timers.map((timer) => timer.at - now),
    emit: (frame: ServerMessage) => emit(frame),
    connectionState: (state: ConnectionState) => connectionListener?.(state),
    hide: () => {
      visible = false;
    },
    show: () => {
      visible = true;
      onVisible?.();
    },
  };
}
