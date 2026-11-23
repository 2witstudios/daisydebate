/**
 * A real process for `process-shutdown.test.ts`: a listening HTTP server,
 * three background workers and the production shutdown, installed on the
 * real SIGTERM. Each step prints one line, so the test reads the order.
 * `stall` keeps Next's close from settling and `stall-stop` keeps one worker's
 * stop from settling, so only the deadline ends it.
 */
import { createServer } from 'node:http';
import { installShutdownSignals } from '@daisy/observability';
import { hostWaits } from '@daisy/worker/host';
import { createProcessShutdown } from './process-shutdown';

const stall = process.argv.includes('stall');
const stallStop = process.argv.includes('stall-stop');
const say = (line: string) => process.stdout.write(`${line}\n`);
let draining = false;
const server = createServer((_request, response) => response.end('ok'));
const worker = (name: string, settleMs: number) => ({
  stop: async () => {
    say(`stop called ${name}`);
    await hostWaits.sleep(settleMs);
    say(`stop settled ${name}`);
  },
});
const work = [
  worker('quick', 0),
  worker('slow', stallStop ? 60_000 : 150),
  worker('mid', 50),
];
installShutdownSignals(
  createProcessShutdown({
    app: {
      isDraining: () => draining,
      drain: () => {
        draining = true;
        say('drain');
      },
      logger: { log: (event: string) => say(`log ${event}`) } as never,
      reportUnfinishedWork: () => say('unfinished work reported'),
    },
    work: () => work,
    server: {
      close: (done) =>
        server.close((error) => {
          say('server closed');
          done(error);
        }),
      closeIdleConnections: () => server.closeIdleConnections(),
      closeAllConnections: () => server.closeAllConnections(),
    },
    nextApp: {
      close: async () => {
        if (stall) {
          say('next close stalls');
          await new Promise<void>(() => undefined);
        }
        say('next closed');
      },
    },
    closeApp: async () => {
      say('app closed');
    },
    waits: hostWaits,
    deadlineMs: 400,
    exit: (code) => {
      say(`exit ${code}`);
      process.exit(code);
    },
  }),
);
server.listen(0, '127.0.0.1', () => say('ready'));
