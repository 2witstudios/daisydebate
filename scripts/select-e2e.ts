import { appendFileSync } from 'node:fs';
import {
  browserOwners,
  queueEnforced,
  selectBrowserSpecs,
} from './affected-e2e';

const command = (args: string[]) => {
  const child = Bun.spawnSync(args, { stdout: 'pipe', stderr: 'pipe' });
  if (child.exitCode !== 0)
    throw new Error('Browser selection input could not be read');
  return child.stdout.toString();
};
const event = process.env.GITHUB_EVENT_NAME ?? '';
let files: string[] = [];
let enforced = false;
if (event === 'pull_request') {
  const payload = await Bun.file(process.env.GITHUB_EVENT_PATH ?? '').json();
  const base = payload.pull_request?.base?.sha;
  if (typeof base !== 'string' || !/^[a-f0-9]{40}$/.test(base))
    throw new Error('Browser selection requires a base SHA');
  files = command(['git', 'diff', '--name-only', '-z', `${base}...HEAD`])
    .split('\0')
    .filter(Boolean);
  try {
    enforced = queueEnforced(
      JSON.parse(
        command([
          'gh',
          'api',
          `repos/${process.env.GITHUB_REPOSITORY}/rules/branches/main`,
        ]),
      ),
    );
  } catch {
    // Unavailable/insufficient permissions never grant narrower evidence.
    enforced = false;
  }
}
const discovered = [
  ...new Bun.Glob('*.e2e.ts').scanSync('apps/web/e2e'),
].sort();
if (
  JSON.stringify(discovered) !==
  JSON.stringify(Object.keys(browserOwners).sort())
)
  throw new Error('Browser ownership inventory differs from discovered specs');
const plan = selectBrowserSpecs(files, event, enforced);
await Bun.write('.turbo/e2e-selection.json', JSON.stringify(plan));
if (process.env.GITHUB_ENV)
  appendFileSync(
    process.env.GITHUB_ENV,
    `DAISY_E2E_EXCLUDE=${JSON.stringify(plan.excluded)}\n`,
  );
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### Browser selection: ${plan.mode}\n${plan.specs.join(', ')}\nNative Launch/realtime profiles: full.\n`,
  );
console.log(
  `Browser selection: ${plan.mode}, ${plan.specs.length} standard specs; native profiles full`,
);
