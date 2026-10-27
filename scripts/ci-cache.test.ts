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
      'pin both cache operations and admit trusted main/pu pushes or same-repository PRs',
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

test('branch saves remain scoped and dispatch/fork writes are refused', async () => {
  const { runInNewContext } = await import('node:vm');
  const action = Bun.YAML.parse(
    read('.github/actions/turbo-cache/action.yml'),
  ) as {
    runs: { steps: { uses?: string; if: string; with?: { key: string } }[] };
  };
  const save = action.runs.steps.find((step) => step.uses?.includes('/save@'))!;
  for (const [event, ref, headRepository, expected] of [
    ['push', 'refs/heads/pu/ci-affected', 'owner/repo', false],
    ['push', 'refs/heads/main', 'owner/repo', true],
    ['push', 'refs/heads/topic', 'owner/repo', false],
    ['workflow_dispatch', 'refs/heads/pu/ci-affected', 'owner/repo', false],
    ['workflow_dispatch', 'refs/heads/main', 'owner/repo', false],
    ['pull_request', 'refs/pull/406/merge', 'fork/repo', false],
    ['pull_request', 'refs/pull/406/merge', 'owner/repo', true],
    ['pull_request_target', 'refs/heads/main', 'fork/repo', false],
  ] as const) {
    const context = {
      inputs: { phase: 'save' },
      github: {
        event_name: event,
        ref,
        repository: 'owner/repo',
        event: {
          pull_request: { head: { repo: { full_name: headRepository } } },
        },
      },
      startsWith: (value: string, prefix: string) => value.startsWith(prefix),
    };
    assert({
      given: `${event} ${ref} ${headRepository}`,
      should: 'admit only trusted branch-scoped saves',
      actual: runInNewContext(save.if, context),
      expected,
    });
    context.inputs.phase = 'restore';
    assert({
      given: `${event} in restore phase`,
      should: 'never save',
      actual: runInNewContext(save.if, context),
      expected: false,
    });
  }
  assert({
    given: 'cache scope managed by GitHub',
    should: 'never override scope with a privileged token or upload to main',
    actual: /token:|GITHUB_TOKEN|cache-mode:|gh cache|ref:/.test(
      read('.github/actions/turbo-cache/action.yml'),
    ),
    expected: false,
  });
});
