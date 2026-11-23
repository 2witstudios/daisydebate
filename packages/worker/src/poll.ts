import type { Waits } from '@daisy/clock';
import {
  nextWaitMs,
  validateIdleBackoff,
  type IdleBackoff,
  type LoopOutcome,
  type LoopPass,
} from './backoff';
import { report, type FailureSink } from './failure';

/** Lossy "work may be waiting" signals for one worker; never authority. */
export type WorkWake = {
  readonly subscribe: (listener: () => void) => () => void;
};

/** A started background worker. */
export type Worker = {
  /**
   * Ends the worker: its signal aborts, so a wait ends at once and work in
   * flight may end between its own steps; resolves when that work has ended.
   */
  readonly stop: () => Promise<void>;
};

export type PollWorker = Worker & {
  /** The first pass, which starts at once. */
  readonly started: Promise<void>;
  /** Work may be waiting: reset the back-off and pass as soon as the busy rate allows. */
  readonly wake: () => void;
};

/** Where the loop is: one state, so a wake has one meaning in each. */
type Phase =
  | { readonly kind: 'passing'; readonly woken: boolean }
  | {
      readonly kind: 'waiting';
      readonly interrupt: AbortController;
      readonly afterFailure: boolean;
    }
  | { readonly kind: 'pacing' }
  | { readonly kind: 'stopped' };

/**
 * Every polling background worker's loop (ADR 0154). One pass at a time in
 * this process: it runs at once, then after a wait the idle back-off sets
 * from what each pass found. A wake resets the back-off and brings the next
 * pass forward, but never sooner than `busyMs` after the last pass started:
 * wakes in between coalesce into that one pass, so the busy interval stays a
 * rate ceiling however often work is created. The back-off cap bounds how
 * late a lost wake can make work. A failed pass is reported and backs off
 * like an empty one, and wakes do not cut that back-off short: a failing
 * store is retried at a growing interval however often work is written.
 * Other instances may run the same loop; each caller's store keeps them off
 * each other's work.
 */
export function pollWork(input: {
  readonly waits: Waits;
  readonly backoff: IdleBackoff;
  /** One pass; `signal` aborts when the worker stops. */
  readonly pass: (signal: AbortSignal) => Promise<LoopPass>;
  readonly failed: FailureSink;
  readonly wake?: WorkWake | undefined;
}): PollWorker {
  const backoff = validateIdleBackoff(input.backoff);
  const { waits } = input;
  const stopping = new AbortController();
  let phase: Phase = { kind: 'passing', woken: false };
  let markStarted = () => {};
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });

  const passOnce = async (): Promise<LoopOutcome> => {
    try {
      return await input.pass(stopping.signal);
    } catch (error) {
      report(input.failed, error);
      return 'failed';
    }
  };
  /** Waits out what is left of the busy interval since `startedAt`. */
  const pace = async (startedAt: number) => {
    phase = { kind: 'pacing' };
    const left = startedAt + backoff.busyMs - waits.nowMs();
    if (left > 0) await waits.sleep(left, stopping.signal);
  };
  const loop = async () => {
    let waitMs: number | null = null;
    let first = true;
    while (!stopping.signal.aborted) {
      const startedAt = waits.nowMs();
      phase = { kind: 'passing', woken: false };
      const pass = passOnce();
      if (first) void pass.then(markStarted);
      first = false;
      const outcome = await pass;
      const woken = phase.kind === 'passing' && phase.woken;
      if (stopping.signal.aborted) break;
      if (woken && outcome !== 'failed') {
        waitMs = null;
        await pace(startedAt);
        continue;
      }
      waitMs = nextWaitMs(backoff, waitMs, outcome);
      const interrupt = new AbortController();
      phase = {
        kind: 'waiting',
        interrupt,
        afterFailure: outcome === 'failed',
      };
      await waits.sleep(
        waitMs,
        AbortSignal.any([stopping.signal, interrupt.signal]),
      );
      if (interrupt.signal.aborted && !stopping.signal.aborted) {
        waitMs = null;
        await pace(startedAt);
      }
    }
    phase = { kind: 'stopped' };
    markStarted();
  };

  const wake = () => {
    switch (phase.kind) {
      case 'passing':
        // Judged when the pass ends: a failed pass ignores it.
        phase = { kind: 'passing', woken: true };
        return;
      case 'waiting':
        if (!phase.afterFailure) phase.interrupt.abort();
        return;
      case 'pacing':
      case 'stopped':
        return;
    }
  };
  const unsubscribe = input.wake?.subscribe(wake);
  const running = loop();
  return {
    started,
    wake,
    async stop() {
      stopping.abort();
      unsubscribe?.();
      await running;
    },
  };
}
