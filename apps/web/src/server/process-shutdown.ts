import type { Waits } from '@daisy/clock';
import { drainWithDeadline } from '@daisy/observability';
import { stopAll } from '@daisy/worker';
import type { App } from './app';
import type { Stoppable } from './feature-work';

/**
 * The production server's shutdown, in its contract's order: drain begins,
 * every background stop is called (`stopAll`) before the listener is told to close, the
 * listener and Next close, every stop is awaited, and only then do the
 * app's pools close. A close that outlasts `deadlineMs` reports any
 * handed-off work it cuts off and exits 1.
 */
export function createProcessShutdown(input: {
  readonly app: Pick<
    App,
    'isDraining' | 'drain' | 'logger' | 'reportUnfinishedWork'
  >;
  readonly work: () => readonly Stoppable[];
  readonly server: {
    readonly close: (done: (error?: Error) => void) => unknown;
    readonly closeIdleConnections: () => void;
    readonly closeAllConnections: () => void;
  };
  readonly nextApp: { readonly close: () => Promise<void> };
  readonly closeApp: () => Promise<void>;
  readonly waits: Waits;
  readonly deadlineMs: number;
  readonly exit: (code: number) => void;
}) {
  const { app, server } = input;
  return async function shutdown() {
    if (app.isDraining()) return;
    app.drain();
    // Every stop is called now, before the drain: each sweep ends between
    // batches. They are awaited below, after the listener closes and before
    // the pools do, within the same deadline as the drain.
    const stopped = stopAll({
      waits: input.waits,
      deadlineMs: input.deadlineMs,
      workers: input.work().map((worker) => ({
        stop: async () => {
          await worker.stop();
        },
      })),
    });
    app.logger.log(
      'server.shutdown',
      { operation: 'server.shutdown' },
      'Draining requests',
    );
    await drainWithDeadline({
      deadlineMs: input.deadlineMs,
      waits: input.waits,
      onDeadlineExceeded: () => {
        // Announces any handed-off mail work the forced exit cuts off.
        app.reportUnfinishedWork();
        server.closeAllConnections();
        input.exit(1);
      },
      close: async () => {
        // Keep-alive sockets would otherwise hold close() until their idle timeout.
        server.closeIdleConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
        await input.nextApp.close();
        await stopped;
        await input.closeApp();
      },
    });
  };
}
