import { appendFileSync } from 'node:fs';
import { nativeSpecs, selectBrowserSpecs } from './browser-selection';

const discovered = [
  ...new Bun.Glob('*.e2e.ts').scanSync('apps/web/e2e'),
].sort();
const missing = nativeSpecs.filter((spec) => !discovered.includes(spec));
if (missing.length > 0)
  throw new Error(`Native browser specs not found: ${missing.join(', ')}`);
const plan = selectBrowserSpecs(
  discovered,
  process.env.GITHUB_EVENT_NAME ?? '',
);
await Bun.write(
  `${process.env.RUNNER_TEMP ?? '.turbo'}/e2e-selection.json`,
  JSON.stringify(plan),
);
if (process.env.GITHUB_ENV)
  appendFileSync(
    process.env.GITHUB_ENV,
    `DAISY_E2E_EXCLUDE=${JSON.stringify(plan.excluded)}\nDAISY_ROOM_LAUNCH_SPECS=${JSON.stringify(plan.nativeSpecs)}\nDAISY_E2E_PROJECT_ARGS=${plan.projectArgs.join(' ')}\n`,
  );
if (process.env.GITHUB_OUTPUT)
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `browsers=${plan.browsers}\nbrowser-key=${plan.browsers.replaceAll(' ', '-')}\n`,
  );
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### Browser selection\n${plan.specs.join(', ')}\nBrowsers: ${plan.browsers}. Native Launch: ${plan.nativeSpecs.join(', ')}. Realtime: full.\n`,
  );
console.log(
  `Browser selection: ${plan.specs.length} standard specs on ${plan.browsers}; native Launch ${plan.nativeSpecs.length} specs; realtime full`,
);
