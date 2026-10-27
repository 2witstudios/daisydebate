import { readFileSync } from 'node:fs';
import { assert, setupRitewayBun, test } from 'riteway/bun';

setupRitewayBun();
const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('CI task results use immutable cache actions with fork writes refused', () => {
  const action = read('.github/actions/turbo-cache/action.yml');
  assert({
    given: 'the shared cache action used by static checks and browser builds',
    should:
      'pin both cache operations and allow saves only on main pushes or same-repository PRs',
    actual: {
      pins: [
        ...action.matchAll(
          /uses: actions\/cache\/(?:restore|save)@([a-f0-9]{40}) # v[\d.]+/g,
        ),
      ].length,
      trustedPush: action.includes(
        "github.event_name == 'push' && github.ref == 'refs/heads/main'",
      ),
      trustedPr: action.includes(
        "github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository",
      ),
      path: action.includes('${{ inputs.checkout }}/.turbo/cache'),
      lock: action.includes("hashFiles('bun.lock', '.bun-version')"),
    },
    expected: {
      pins: 2,
      trustedPush: true,
      trustedPr: true,
      path: true,
      lock: true,
    },
  });
});

test('runtime build identity does not invalidate unchanged unit and type tasks', () => {
  const config = JSON.parse(read('turbo.json'));
  assert({
    given: 'a new commit identity with unchanged static inputs',
    should: 'hash identity for builds while retaining static cache eligibility',
    actual: {
      global: config.globalEnv,
      build: config.tasks.build.env,
      uncached: ['test:integration', 'test:e2e'].map(
        (task) => config.tasks[task].cache,
      ),
    },
    expected: {
      global: ['NODE_ENV'],
      build: ['APP_VERSION', 'GIT_COMMIT'],
      uncached: [false, false],
    },
  });
});

test('persisted results include root operational inputs and stay in the owning checkout', () => {
  const config = JSON.parse(read('turbo.json'));
  assert({
    given:
      'external deployment policy, migration baseline and runner sources used by workspace tests',
    should:
      'invalidate cached results and use a checkout-local cache in linked worktrees',
    actual: {
      cacheDir: config.cacheDir,
      inputs: [
        'fly*.toml',
        'policy/**',
        'scripts/**',
        'infra/**',
        '.github/**',
        'tsconfig.json',
        'bunfig.toml',
        '.env*',
      ].filter((input) => config.globalDependencies.includes(input)),
    },
    expected: {
      cacheDir: '.turbo/cache',
      inputs: [
        'fly*.toml',
        'policy/**',
        'scripts/**',
        'infra/**',
        '.github/**',
        'tsconfig.json',
        'bunfig.toml',
        '.env*',
      ],
    },
  });
});
