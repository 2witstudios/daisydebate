import { assert, setupRitewayBun, test } from 'riteway/bun';

setupRitewayBun();

type Step = {
  id?: string;
  if?: string;
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, string>;
  'timeout-minutes'?: number;
};
type Workflow = { jobs: Record<string, { steps: Step[] }> };

const read = (path: string) =>
  Bun.file(new URL(`../${path}`, import.meta.url)).text();
const workflow = async (path: string) =>
  Bun.YAML.parse(await read(path)) as Workflow;

const cacheAction =
  'actions/cache/restore@55cc8345863c7cc4c66a329aec7e433d2d1c52a9';
const saveAction =
  'actions/cache/save@55cc8345863c7cc4c66a329aec7e433d2d1c52a9';

const browserJobs = async () => {
  const files = ['.github/workflows/e2e.yml', '.github/workflows/ci.yml'];
  const parsed = await Promise.all(files.map(workflow));
  return parsed.flatMap((value) =>
    Object.entries(value.jobs).filter(([, job]) =>
      job.steps.some((step) =>
        /cli\.js install|ci-browsers\.sh/.test(step.run ?? ''),
      ),
    ),
  );
};

// The shape every Playwright install must keep: one bounded script, behind a
// version-keyed cache restore, saved right after so a later failure in the
// job still keeps the warm cache.
const installShape = (steps: readonly Step[]) => {
  const index = steps.findIndex((step) =>
    /ci-browsers\.sh/.test(step.run ?? ''),
  );
  const install = steps[index];
  const restore = steps
    .slice(0, index)
    .find((step) => step.uses === cacheAction);
  const save = steps.slice(index + 1).find((step) => step.uses === saveAction);
  return {
    bounded: (install?.['timeout-minutes'] ?? Infinity) <= 8,
    ...cacheShape(restore ?? {}, save ?? {}),
    unboundedApt: steps.some((step) =>
      /--with-deps|apt-get/.test(step.run ?? ''),
    ),
  };
};

const cacheShape = (restore: Step, save: Step) => ({
  cachesBrowsers: restore.with?.path?.includes('~/.cache/ms-playwright'),
  cachesDebs: restore.with?.path?.includes('~/.cache/daisy-apt-archives'),
  keyedOnVersion: restore.with?.key?.includes(
    '${{ steps.playwright.outputs.version }}-${{ steps.playwright.outputs.month }}',
  ),
  savesOnMiss:
    save.if === `\${{ steps.${restore.id}.outputs.cache-hit != 'true' }}` &&
    save.with?.key === `\${{ steps.${restore.id}.outputs.cache-primary-key }}`,
});

test('every Playwright browser install is cached and bounded', async () => {
  const jobs = await browserJobs();
  assert({
    given: 'each workflow job that installs Playwright browsers',
    should:
      'restore a version-keyed browser and .deb cache, install through the bounded script under a step timeout, and save on a miss',
    actual: Object.fromEntries(
      jobs.map(([name, job]) => [name, installShape(job.steps)]),
    ),
    expected: Object.fromEntries(
      ['e2e', 'room-launch'].map((name) => [
        name,
        {
          bounded: true,
          cachesBrowsers: true,
          cachesDebs: true,
          keyedOnVersion: true,
          savesOnMiss: true,
          unboundedApt: false,
        },
      ]),
    ),
  });
});

test('the cache key reads the exact installed @playwright/test version', async () => {
  const jobs = await browserJobs();
  assert({
    given: 'the version step in each browser job',
    should:
      'read the resolved package version, not a range or the lockfile, plus the UTC month so cached .debs follow Ubuntu updates',
    actual: jobs.map(
      ([, job]) => job.steps.find((step) => step.id === 'playwright')?.run,
    ),
    expected: jobs.map(() =>
      [
        'echo "version=$(jq -r .version apps/web/node_modules/@playwright/test/package.json)" >> "$GITHUB_OUTPUT"',
        'echo "month=$(date -u +%Y-%m)" >> "$GITHUB_OUTPUT"',
        '',
      ].join('\n'),
    ),
  });
});

test('apt is bounded per request and per attempt, with at most three attempts', async () => {
  const script = await read('scripts/ci-browsers.sh');
  assert({
    given: 'the browser install script',
    should:
      'configure apt retries and short network timeouts, kill a stalled attempt and stop after three',
    actual: {
      retries: script.includes('Acquire::Retries "3";'),
      httpTimeout: script.includes('Acquire::http::Timeout "20";'),
      httpsTimeout: script.includes('Acquire::https::Timeout "20";'),
      attemptKill: /sudo timeout -k \S+ "\$attempt_seconds"/.test(script),
      maxAttempts: script.includes('[ "$attempt" -ge 3 ]'),
      // ubuntu-24.04 runners read mirrors from mirror+file, not the URL in
      // the .sources file, so the retry must rewrite that list.
      switchesMirror: script.includes('/etc/apt/apt-mirrors.txt'),
    },
    expected: {
      retries: true,
      httpTimeout: true,
      httpsTimeout: true,
      attemptKill: true,
      maxAttempts: true,
      switchesMirror: true,
    },
  });
});
