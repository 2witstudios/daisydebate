import type { Waits } from '@daisy/clock';
import { drainWithDeadline } from '@daisy/observability';
import type { App } from './app';

/** What shutdown needs of each piece of background work. */
export type Stoppable = { readonly stop: () => Promise<unknown> };

/**
 * The production server's shutdown, in its contract's order: drain begins,
 * every background stop is called before the listener is told to close, the
 * listener and Next close, every stop is awaited, and only then do the
 * app's pools close. A close that outlasts `deadlineMs` reports any
 * handed-off work it cuts off and exits 1.
 */
export function createProcessShutdown(input: {
  readonly app: Pick<
    App,
    'isDraining' | 'drain' | 'logger' | 'reportUnfinishedWork'
  >;
  readonly work: () => readonly (Stoppable | null | undefined)[];
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
    // Ends any sweep between batches; awaited before the pools close below.
    const stopped = input
      .work()
      .flatMap((worker) => (worker ? [worker.stop()] : []));
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
        await Promise.all(stopped);
        await input.closeApp();
      },
    });
  };
}
