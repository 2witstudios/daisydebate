import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';

setupRitewayBun();

type Workspace = {
  path: string;
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  exports?: unknown;
};

const root = JSON.parse(readFileSync('package.json', 'utf8')) as {
  workspaces: string[];
};
const workspaces: Workspace[] = root.workspaces.flatMap((pattern) =>
  Array.from(new Bun.Glob(`${pattern}/package.json`).scanSync('.')).map(
    (file) => ({
      ...JSON.parse(readFileSync(file, 'utf8')),
      path: posix.dirname(file),
    }),
  ),
);
const dockerfile = readFileSync('apps/web/Dockerfile', 'utf8');

// Follow declared workspace edges, including dev edges for the build install.
// Packages are shipped as source; realtime remains a separate deployment.
const requiredWorkspaces = (all: Workspace[], production: boolean) => {
  const required = new Set(
    all.filter(
      ({ path }) => path === 'apps/web' || path.startsWith('packages/'),
    ),
  );
  for (const workspace of required) {
    const dependencies = {
      ...workspace.dependencies,
      ...workspace.optionalDependencies,
      ...(!production && workspace.devDependencies),
    };
    for (const [name, version] of Object.entries(dependencies)) {
      if (!version.startsWith('workspace:')) continue;
      const dependency = all.find((candidate) => candidate.name === name);
      if (!dependency) throw new Error(`Unknown workspace ${name}`);
      required.add(dependency);
    }
  }
  return [...required];
};

const exportPaths = (exports: unknown): string[] => {
  if (typeof exports === 'string') return [exports];
  if (exports && typeof exports === 'object')
    return Object.values(exports).flatMap(exportPaths);
  return [];
};

const stageLines = (source: string, stage: string) => {
  const stages = source.split(/^FROM .* AS /m).slice(1);
  const lines = stages.find((value) => value.startsWith(`${stage}\n`));
  if (!lines) throw new Error(`Missing Docker stage ${stage}`);
  return lines
    .split('\n')
    .slice(1)
    .filter((line) => !line.trim().startsWith('#'));
};

// Deliberately enforce the image's explicit same-path COPY contract. A new
// COPY syntax or stage layout needs reviewed coverage, never a silent pass.
const copies = (lines: string[], path: string) =>
  lines.some((line) => {
    const tokens = line.trim().split(/\s+/);
    return (
      tokens.shift() === 'COPY' &&
      !tokens.some((token) => token.startsWith('--from=')) &&
      tokens.filter((token) => !token.startsWith('--')).join(' ') ===
        `${path} ${path}`
    );
  });

const imageProblems = (source: string, all = workspaces) => {
  const problems: string[] = [];
  for (const stage of ['deps', 'prod-deps']) {
    const lines = stageLines(source, stage);
    const install = lines.findIndex((line) =>
      line.startsWith('RUN bun install '),
    );
    const expected = `RUN bun install --frozen-lockfile${stage === 'prod-deps' ? ' --production' : ''}`;
    if (lines[install] !== expected)
      problems.push(`${stage}: frozen install missing`);
    for (const { path } of requiredWorkspaces(all, stage === 'prod-deps')) {
      if (!copies(lines.slice(0, Math.max(0, install)), `${path}/package.json`))
        problems.push(`${stage}: missing ${path}/package.json before install`);
    }
  }
  const runtime = stageLines(source, 'runtime');
  if (!copies(runtime, 'apps/web/src'))
    problems.push('runtime: missing apps/web/src');
  for (const workspace of requiredWorkspaces(all, true)) {
    for (const path of new Set(
      exportPaths(workspace.exports)
        .filter((path) => path.startsWith('./src/'))
        .map(() => `${workspace.path}/src`),
    )) {
      if (!copies(runtime, path)) problems.push(`runtime: missing ${path}`);
    }
  }
  return problems.sort();
};

describe('web and migrator Docker workspace inputs (ISSUE-405)', () => {
  test('the committed image includes the dependency graph before frozen installs and at runtime', () => {
    assert({
      given: 'real workspace manifests and the shared web/migrator Dockerfile',
      should: 'have complete install and runtime inputs',
      actual: imageProblems(dockerfile),
      expected: [],
    });
  });

  test('removing any required manifest or runtime source is detected', () => {
    const copiesToRemove = dockerfile
      .split('\n')
      .filter((line) =>
        /^COPY (?:--chown=\S+ )?(?:apps\/web|packages\/[^/]+)\/(?:package.json|src) /.test(
          line,
        ),
      );
    assert({
      given:
        'each manifest/source COPY independently removed from the real image',
      should: 'reject every missing input',
      actual: copiesToRemove.filter(
        (line) => imageProblems(dockerfile.replace(line, '')).length === 0,
      ),
      expected: [],
    });
  });

  test('a manifest copied only after the install does not satisfy its input', () => {
    const copy =
      'COPY packages/ingress/package.json packages/ingress/package.json';
    const source = dockerfile
      .replace(copy, '')
      .replace(
        'RUN bun install --frozen-lockfile\n',
        `RUN bun install --frozen-lockfile\n${copy}\n`,
      );
    assert({
      given: 'ingress copied too late in deps',
      should: 'name the install-stage omission',
      actual: imageProblems(source),
      expected: ['deps: missing packages/ingress/package.json before install'],
    });
  });

  test('a new transitive workspace outside packages is required without editing a name list', () => {
    const all = workspaces.map((workspace) =>
      workspace.name === '@daisy/ingress'
        ? {
            ...workspace,
            dependencies: {
              ...workspace.dependencies,
              '@daisy/new-runtime': 'workspace:*',
            },
          }
        : workspace,
    );
    all.push({
      name: '@daisy/new-runtime',
      path: 'apps/new-runtime',
      exports: { '.': './src/index.ts' },
    });
    assert({
      given: 'web → ingress → a previously unseen workspace',
      should: 'require its manifest in both installs and its runtime source',
      actual: imageProblems(dockerfile, all),
      expected: [
        'deps: missing apps/new-runtime/package.json before install',
        'prod-deps: missing apps/new-runtime/package.json before install',
        'runtime: missing apps/new-runtime/src',
      ],
    });
  });

  test('comments and copies to a different destination cannot supply runtime source', () => {
    const copy =
      'COPY --chown=daisy:daisy packages/ingress/src packages/ingress/src';
    assert({
      given:
        'the ingress source copy commented out or copied to the wrong path',
      should: 'reject both incomplete runtime images',
      actual: [`# ${copy}`, copy.replace(/src$/, 'wrong')].map((replacement) =>
        imageProblems(dockerfile.replace(copy, replacement)),
      ),
      expected: [
        ['runtime: missing packages/ingress/src'],
        ['runtime: missing packages/ingress/src'],
      ],
    });
  });
});

test('CI requires the real shared runtime image build', () => {
  const workflow = Bun.YAML.parse(
    readFileSync('.github/workflows/ci.yml', 'utf8'),
  ) as {
    jobs: Record<string, { needs?: string[]; steps?: { run?: string }[] }>;
  };
  assert({
    given: 'the committed CI workflow',
    should: 'build the Docker runtime image and require that job in CI gate',
    actual: {
      build:
        workflow.jobs.image?.steps?.some(
          ({ run }) =>
            run?.includes('docker build') &&
            run.includes('-f apps/web/Dockerfile') &&
            !run.includes('--target'),
        ) ?? false,
      required: workflow.jobs.gate?.needs?.includes('image') ?? false,
    },
    expected: { build: true, required: true },
  });
});
