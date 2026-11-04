import { runLaunchProof } from './room-launch-runner';
import { drillBrowserPorts } from '../../scripts/node-kill-drill/local-ports';

await runLaunchProof({
  config: 'e2e/support/node-kill-drill-config.ts',
  ...drillBrowserPorts(process.env),
});
