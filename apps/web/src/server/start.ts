import { hostWaits } from '@daisy/worker/host';
import { releaseFlagDefault } from '../features/flags/release-default';
import { readFileSync } from 'node:fs';
import next from 'next';
import { refuseSchemaAlteringRole } from '@daisy/db';
import { installShutdownSignals } from '@daisy/observability';
import {
  closeProcessApp,
  processApp,
  processStartOptions,
  fetchPublicAttendanceProbe,
  processVendorFetch,
} from './process-app';
import { startProductionServer } from './listen-first';
import { createProcessShutdown } from './process-shutdown';
import { startProcessWork } from './process-work';
import { SHUTDOWN_DRAIN_DEADLINE_MS } from './shutdown-budget';

// Refuses anything but NODE_ENV=production before building the app.
const { port, host } = processStartOptions();
const app = processApp();
const nextApp = next({ dev: false, port });
// Production must not boot without validated auth configuration (secret,
// Resend sender/key, webhook secret, HTTPS origin): building the server
// reads it eagerly and its errors name fields only. startProductionServer
// opens the port first behind a start-up gate (ISSUE-172), refuses a
// DATABASE_URL role that could create or alter schema objects, prepares
// Next, and only then lets a request reach Next (ISSUE-39, ISSUE-193); a
// refusal rejects `started` and the process exits.
// Closed before the listener opens: a broken attendance probe is named before this
// process takes traffic. Settled below, once the check has run.
const probeCheck = Promise.withResolvers<void>();
app.holdReadinessUntil(probeCheck.promise);
const { server, started } = startProductionServer({
  app,
  nextApp,
  refuseRole: () => refuseSchemaAlteringRole(app, 'daisy_web'),
  // The one read of the route table, for the `gateway` keyword in
  // AUTH_TRUSTED_PROXIES (ISSUE-162); unreadable, it trusts nothing for it.
  readRouteTable: () => {
    try {
      return readFileSync('/proc/net/route', 'utf8');
    } catch {
      return null;
    }
  },
  port,
  host,
});
await started;
// ADR 0118: the effective release-flag default, once per process. Only
// staging may set DAISY_RELEASE_FLAG_DEFAULT; config refused it elsewhere.
app.logger.log(
  'flags.release_default',
  {
    operation: 'flags.release_default',
    // `environment`: release flags with no stored choice are on (staging);
    // `catalogue`: each keeps its safe default (off).
    source: releaseFlagDefault(app.config) ? 'environment' : 'catalogue',
  },
  'Release flag default resolved',
);
const { workers, probeChecked } = await startProcessWork({
  app,
  waits: hostWaits,
  vendorFetch: processVendorFetch(),
  probeFetch: fetchPublicAttendanceProbe,
});
// A slow read holds readiness at most 2 s: the check reports, it never refuses.
void Promise.race([probeChecked, hostWaits.sleep(2000)]).finally(() =>
  probeCheck.resolve(),
);
const shutdown = createProcessShutdown({
  app,
  work: () => workers,
  server,
  nextApp,
  closeApp: closeProcessApp,
  waits: hostWaits,
  deadlineMs: SHUTDOWN_DRAIN_DEADLINE_MS,
  exit: (code) => process.exit(code),
});
installShutdownSignals(shutdown);
