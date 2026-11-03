import { resolve } from 'node:path';
import { systemClock } from '@daisy/clock';
import { browserDriverOptions, finishBrowserDriver } from './browser-driver';
import {
  drillKillPlan,
  readDrillTarget,
} from '../../scripts/node-kill-drill/target';

/**
 * Runs the node kill drill through the Launch harness, in the heavy queue, never
 * in CI: `bun drill:node-kill`. It refuses before queuing unless every target is
 * a daisy-mr- app. Report: test-results/node-kill-drill/<label>-<time>/.
 *
 * DRILL_LABEL          a short lowercase name for the run
 * DRILL_NODES          JSON list of { app, machine, apiUrl, publicUrl, media };
 *                      media is the node's ICE address, with :port when shared
 * DRILL_KILL_COMMAND, DRILL_START_COMMAND, DRILL_STATE_COMMAND
 *                      JSON argument lists run with no shell, with {app} and
 *                      {machine} filled in: fly or docker only
 * DRILL_LIVEKIT_API_KEY, DRILL_LIVEKIT_API_SECRET   the scratch nodes' keys
 * DRILL_KILLS          "<mid-speech>,<floor-change>"; default "5,1"
 * ROOM_LAUNCH_MEDIA_EDGES   local proof only: JSON list of { port, upstreamPort }
 */
const target = readDrillTarget(process.env);
drillKillPlan(process.env.DRILL_KILLS);
const checkout = resolve(import.meta.dir, '../../../..');
const commit = Bun.spawnSync(['git', 'rev-parse', '--short', 'HEAD'], {
  cwd: checkout,
})
  .stdout.toString()
  .trim();
const stamp = systemClock.now().replace(/[:.]/g, '-');
const queued = Bun.spawn(
  [
    'bun',
    '../../scripts/heavy.ts',
    'bun',
    'e2e/support/node-kill-drill-queued.ts',
    ...Bun.argv.slice(2),
  ],
  browserDriverOptions(checkout, {
    ...process.env,
    DRILL_COMMIT: commit,
    DRILL_RUN_DIR: resolve(
      checkout,
      `apps/web/test-results/node-kill-drill/${target.label}-${stamp}`,
    ),
  }),
);
await finishBrowserDriver(queued);
