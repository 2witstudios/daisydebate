import { assert, setupRitewayBun, test } from 'riteway/bun';

setupRitewayBun();

test('browser TLS fixtures have their system certificate generator', async () => {
  const script = await Bun.file('scripts/ci-browsers.sh').text();
  assert({
    given: 'the browser runner provisions OS packages',
    should: 'install OpenSSL for ephemeral HTTPS fixture certificates',
    actual: /apt-get install[^\n]*\bopenssl\b/.test(script),
    expected: true,
  });
});

type Step = {
  id?: string;
  if?: string;
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, string>;
  'timeout-minutes'?: number;
};
type Workflow = { jobs: Record<string, { steps?: Step[] }> };

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
    Object.entries(value.jobs)
      .map(([name, job]) => [name, { steps: job.steps ?? [] }] as const)
      .filter(([, job]) =>
        job.steps.some((step) =>
          /cli\.js install|ci-browsers\.sh/.test(step.run ?? ''),
        ),
      ),
  );
};

// The shape every Playwright install must keep: one bounded script, behind
// a version-keyed browser restore and a rolling .deb restore, both saved right
// after so a later failure in the job still keeps the warm cache.
const installShape = (steps: readonly Step[]) => {
  const index = steps.findIndex((step) =>
    /ci-browsers\.sh/.test(step.run ?? ''),
  );
  const install = steps[index];
  const before = steps.slice(0, index);
  const after = steps.slice(index + 1);
  const restore = before.find((step) => step.id === 'browser-cache') ?? {};
  const debs = before.find((step) => step.id === 'deb-cache') ?? {};
  const save = (path: string) =>
    after.find(
      (step) => step.uses === saveAction && step.with?.path === path,
    ) ?? {};
  return {
    bounded: (install?.['timeout-minutes'] ?? Infinity) <= 8,
    ...cacheShape(restore, save('~/.cache/ms-playwright')),
    ...debShape(
      debs,
      save('~/.cache/daisy-apt-archives'),
      install?.id,
      restore,
    ),
    unboundedApt: steps.some((step) =>
      /--with-deps|apt-get/.test(step.run ?? ''),
    ),
  };
};

const version = '${{ steps.playwright.outputs.version }}';
const cacheShape = (restore: Step, save: Step) => ({
  cachesBrowsers:
    restore.uses === cacheAction &&
    restore.with?.path === '~/.cache/ms-playwright',
  keyedOnVersion: restore.with?.key?.includes(`-${version}-`),
  savesOnMiss:
    save.if === `\${{ steps.${restore.id}.outputs.cache-hit != 'true' }}` &&
    save.with?.key === `\${{ steps.${restore.id}.outputs.cache-primary-key }}`,
});

// A fixed key would keep the first .deb set of its period: every Ubuntu
// update after it went back to the mirror (main at db7db271b fetched 11 of
// 32 MB on a warm hit). The newest entry for the same browser set restores;
// a changed set saves anew. The set is in the prefix, so a Chromium-only job
// never prunes the nightly's firefox/webkit packages away, and "_" ends it,
// so "chromium_" is no prefix of "chromium-firefox-webkit_".
const debShape = (
  restore: Step,
  save: Step,
  install: string | undefined,
  browsers: Step,
) => {
  const set = browsers.with?.key?.split(`-${version}-`)[1];
  const prefix = `playwright-debs-\${{ runner.os }}-\${{ runner.arch }}-${version}-${set}_`;
  return {
    cachesDebs:
      restore.uses === cacheAction &&
      restore.with?.path === '~/.cache/daisy-apt-archives',
    rollingDebs:
      set !== undefined &&
      restore.with?.['restore-keys'] === prefix &&
      restore.with?.key ===
        `${prefix}\${{ github.run_id }}-\${{ github.run_attempt }}`,
    savesChangedDebs:
      install !== undefined &&
      save.if === `\${{ steps.${install}.outputs.debs == 'changed' }}` &&
      save.with?.key ===
        `\${{ steps.${restore.id}.outputs.cache-primary-key }}`,
  };
};

test('every Playwright browser install is cached and bounded', async () => {
  const jobs = await browserJobs();
  assert({
    given: 'each workflow job that installs Playwright browsers',
    should:
      'restore version-keyed browsers and the newest .debs, install through the bounded script under a step timeout, and save a miss or a changed .deb set',
    actual: Object.fromEntries(
      jobs.map(([name, job]) => [name, installShape(job.steps)]),
    ),
    expected: Object.fromEntries(
      ['e2e', 'admin', 'room-launch'].map((name) => [
        name,
        {
          bounded: true,
          cachesBrowsers: true,
          keyedOnVersion: true,
          savesOnMiss: true,
          cachesDebs: true,
          rollingDebs: true,
          savesChangedDebs: true,
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
    should: 'read the resolved package version, not a range or the lockfile',
    actual: jobs.map(
      ([, job]) => job.steps.find((step) => step.id === 'playwright')?.run,
    ),
    expected: jobs.map(
      () =>
        'echo "version=$(jq -r .version apps/web/node_modules/@playwright/test/package.json)" >> "$GITHUB_OUTPUT"\n',
    ),
  });
});

test('the prune loop keeps readable installed versions and reports a changed set', async () => {
  const {
    mkdtempSync,
    writeFileSync,
    chmodSync,
    readdirSync,
    readFileSync,
    rmSync,
  } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const script = await read('scripts/ci-browsers.sh');
  const loop = script.slice(
    script.indexOf('for deb in "$deb_cache"/*.deb; do'),
    script.indexOf('"$bun" "$cli" install "$@"'),
  );
  const root = mkdtempSync(join(tmpdir(), 'daisy-browser-debs-'));
  try {
    const bin = join(root, 'bin');
    const cache = join(root, 'debs');
    Bun.spawnSync(['mkdir', '-p', bin, cache]);
    for (const name of ['good', 'old', 'absent', 'bad'])
      writeFileSync(join(cache, `${name}.deb`), name);
    const stub = (name: string, body: string) => {
      writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
      chmodSync(join(bin, name), 0o755);
    };
    stub(
      'dpkg-deb',
      'case "$2" in *bad.deb) exit 2;; esac\nif [ "$3" = Package ]; then basename "$2" .deb; else echo 1; fi',
    );
    stub(
      'dpkg-query',
      'case "$3" in good) echo 1;; old) echo 0;; *) exit 1;; esac',
    );
    const output = join(root, 'output');
    writeFileSync(output, '');
    const run = Bun.spawnSync(
      [
        'sh',
        '-euc',
        `deb_cache=${cache}\ndebs_before=$(ls "$deb_cache" | sort | cksum)\n${loop}`,
      ],
      {
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          GITHUB_OUTPUT: output,
        },
      },
    );
    assert({
      given:
        'a cache with a readable installed, an older, an uninstalled and an unreadable .deb',
      should:
        'finish under set -eu, keep only the installed version and report the change',
      actual: {
        exit: run.exitCode,
        kept: readdirSync(cache),
        output: readFileSync(output, 'utf8'),
      },
      expected: { exit: 0, kept: ['good.deb'], output: 'debs=changed\n' },
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a retry waits for the killed attempt to release the package lock', async () => {
  const { mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync } =
    await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const script = await read('scripts/ci-browsers.sh');
  const lock = script.slice(
    script.indexOf('await_package_lock() {'),
    script.indexOf('mkdir -p "$deb_cache"'),
  );
  const retry = script.slice(
    script.indexOf('echo "Retrying browser OS dependencies'),
    script.indexOf('# ubuntu-24.04 runners resolve'),
  );
  // `holds` is how many polls still find the earlier dpkg alive.
  const run = (holds: number) => {
    const root = mkdtempSync(join(tmpdir(), 'daisy-browser-lock-'));
    try {
      const calls = join(root, 'calls');
      const left = join(root, 'left');
      writeFileSync(calls, '');
      writeFileSync(left, String(holds));
      const stub = (name: string, body: string) => {
        writeFileSync(join(root, name), `#!/bin/sh\n${body}\n`);
        chmodSync(join(root, name), 0o755);
      };
      stub(
        'pgrep',
        `n=$(cat ${left}); [ "$n" -gt 0 ] || exit 1; echo $((n - 1)) > ${left}`,
      );
      stub('sleep', `echo sleep >> ${calls}`);
      stub('sudo', `echo "$@" >> ${calls}`);
      const result = Bun.spawnSync(
        ['sh', '-euc', `${lock}\nattempt=2\n${retry}`],
        {
          env: {
            ...process.env,
            PATH: `${root}:${process.env.PATH}`,
            LOCK_WAIT_SECONDS: '3',
          },
        },
      );
      return {
        exit: result.exitCode,
        calls: readFileSync(calls, 'utf8').trim().split('\n'),
      };
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };
  assert({
    given: "a retry while the killed attempt's dpkg lives for two more polls",
    should: 'wait for it to exit and only then repair the package database',
    actual: run(2),
    expected: { exit: 0, calls: ['sleep', 'sleep', 'dpkg --configure -a'] },
  });
  assert({
    given: 'a retry while that dpkg outlives the wait',
    should: 'end it after the bound, then repair the package database',
    actual: run(99),
    expected: {
      exit: 0,
      calls: [
        'sleep',
        'sleep',
        'sleep',
        'pkill -KILL -x dpkg|apt-get',
        'dpkg --configure -a',
      ],
    },
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
