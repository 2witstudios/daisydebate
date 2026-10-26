import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';

setupRitewayBun();

type Step = {
  id?: string;
  run?: string;
  uses?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
};
type Job = {
  'runs-on': string;
  needs?: string | string[];
  permissions?: Record<string, string>;
  steps: Step[];
};
type Workflow = {
  on: Record<string, { inputs?: Record<string, { required?: boolean }> }>;
  permissions: Record<string, string>;
  jobs: Record<string, Job>;
};

const path = '.github/workflows/rebaseline-visuals.yml';
const read = (file: string) =>
  readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const workflow = Bun.YAML.parse(read(path)) as Workflow;
const e2e = Bun.YAML.parse(read('.github/workflows/e2e.yml')) as Workflow;
const jobText = (job: Job) => JSON.stringify(job);

describe('Rebaseline visuals workflow (ADR 0073)', () => {
  const { resolve, render, commit } = workflow.jobs as Record<string, Job>;

  test('it is a manual action on one target', () => {
    assert({
      given: 'the workflow triggers',
      should: 'run only on manual dispatch with a required target input',
      actual: {
        triggers: Object.keys(workflow.on),
        target: workflow.on.workflow_dispatch?.inputs?.target?.required,
      },
      expected: { triggers: ['workflow_dispatch'], target: true },
    });
  });

  test('only the job that runs no branch code may write', () => {
    assert({
      given: 'the workflow and job permissions',
      should:
        'grant nothing by default, read to resolve and render, and contents: write to commit alone',
      actual: {
        workflow: workflow.permissions,
        resolve: resolve?.permissions,
        render: render?.permissions,
        commit: commit?.permissions,
      },
      expected: {
        workflow: {},
        resolve: { contents: 'read', 'pull-requests': 'read' },
        render: { contents: 'read' },
        commit: { contents: 'write' },
      },
    });
  });

  test('branch code renders without credentials on the E2E runner image', () => {
    const checkout = render?.steps.find((step) =>
      step.uses?.startsWith('actions/checkout@'),
    );
    assert({
      given: 'the render job',
      should:
        'run on the Playwright E2E runner image, keep no checkout token, read no secret or token, and update snapshots of the visual project',
      actual: {
        runsOn: render?.['runs-on'],
        persistCredentials: checkout?.with?.['persist-credentials'],
        credential: /secrets\.|github\.token/.test(jobText(render!)),
        renders: render?.steps.some(
          (step) =>
            step.run ===
            'bun run --cwd apps/web test:e2e --project=visual --update-snapshots',
        ),
      },
      expected: {
        runsOn: e2e.jobs.e2e?.['runs-on'],
        persistCredentials: false,
        credential: false,
        renders: true,
      },
    });
  });

  test('the writing job stages only the baselines folder', () => {
    const script = commit?.steps.map((step) => step.run ?? '').join('\n');
    assert({
      given: 'the commit job',
      should:
        'install and run nothing from the branch, stage only the baselines folder with a conventional message and push to the resolved branch',
      actual: {
        runsBranchCode: /\bbun\b|\bnode\b|\bnpm\b/.test(script ?? ''),
        stages: script?.match(/git add [^\n]*/g),
        message: script?.includes("-m 'test(visual): rebaseline"),
        push: script?.includes('git push origin "HEAD:refs/heads/$BRANCH"'),
      },
      expected: {
        runsBranchCode: false,
        stages: ['git add -- apps/web/e2e/visual-baselines'],
        message: true,
        push: true,
      },
    });
  });
});

/** Runs the resolve step's script against a stub `gh` answering `reply`. */
const runResolve = (target: string, reply: string) => {
  const step = workflow.jobs.resolve!.steps.find(({ id }) => id === 'target')!;
  const dir = mkdtempSync(join(tmpdir(), 'rebaseline-resolve-'));
  try {
    const gh = join(dir, 'gh');
    writeFileSync(gh, `#!/bin/sh\ncat <<'JSON'\n${reply}\nJSON\n`);
    chmodSync(gh, 0o755);
    const output = join(dir, 'output');
    writeFileSync(output, '');
    const run = Bun.spawnSync(['bash', '-c', step.run!], {
      env: {
        PATH: `${dir}:${process.env.PATH}`,
        GITHUB_REPOSITORY: 'owner/daisy',
        GITHUB_OUTPUT: output,
        TARGET: target,
        DEFAULT_BRANCH: 'main',
      },
    });
    return {
      ok: run.exitCode === 0,
      output: readFileSync(output, 'utf8'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const sha = 'a'.repeat(40);
const pull = (repo: string, ref: string) =>
  JSON.stringify({ head: { repo: { full_name: repo }, ref, sha } });

describe('Rebaseline visuals target resolution', () => {
  test('a same-repository pull request', () => {
    assert({
      given: 'a pull request number whose head is in this repository',
      should: 'resolve its head branch and exact commit',
      actual: runResolve('12', pull('owner/daisy', 'pu/lobby')),
      expected: { ok: true, output: `branch=pu/lobby\nsha=${sha}\n` },
    });
  });

  test('a fork pull request', () => {
    assert({
      given: 'a pull request number whose head is a fork',
      should: 'refuse it',
      actual: runResolve('12', pull('someone/daisy', 'pu/lobby')),
      expected: { ok: false, output: '' },
    });
  });

  test('main as a pull request head or a branch', () => {
    assert({
      given: 'main named directly or as a pull request head',
      should: 'refuse both',
      actual: [
        runResolve('main', sha).ok,
        runResolve('12', pull('owner/daisy', 'main')).ok,
      ],
      expected: [false, false],
    });
  });

  test('a branch name that is not plain', () => {
    assert({
      given: 'a branch name with a parent-path segment or shell characters',
      should: 'refuse it before any API call',
      actual: [runResolve('../pulls', sha).ok, runResolve('pu/x;id', sha).ok],
      expected: [false, false],
    });
  });

  test('a plain same-repository branch', () => {
    assert({
      given: 'a branch name that resolves to a commit',
      should: 'resolve that branch and commit',
      actual: runResolve('pu/visual-core', sha),
      expected: { ok: true, output: `branch=pu/visual-core\nsha=${sha}\n` },
    });
  });
});
