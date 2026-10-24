import { uncommented } from './deploy-config-text';

/**
 * ISSUE-527: the image's `next build` skips its own TypeScript pass, which
 * stalled Fly's remote builder for 25+ minutes and is a duplicate: CI's
 * typecheck gates every commit deploy-staging ships (staging-gate.ts). The
 * skip must stay scoped to the image, so `bun run build` and `bun check`
 * still typecheck: next.config.ts keys it on DAISY_IMAGE_BUILD alone, and
 * only the Dockerfile's build stage sets that.
 */
export function findImageTypecheckProblem(input: {
  readonly dockerfile: string;
  readonly nextConfig: string;
}): string | null {
  const config = uncommented(input.nextConfig);
  const scoped =
    /ignoreBuildErrors:\s*process\.env\.DAISY_IMAGE_BUILD === '1'/.test(
      config,
    ) && (config.match(/ignoreBuildErrors/g) ?? []).length === 1;
  const docker = uncommented(input.dockerfile);
  const settings = docker.match(/DAISY_IMAGE_BUILD=1/g) ?? [];
  const inBuild =
    /RUN DAISY_IMAGE_BUILD=1 NODE_ENV=production bun run --cwd apps\/web build/.test(
      docker,
    );
  return scoped && inBuild && settings.length === 1
    ? null
    : "next.config.ts must skip type errors only for the image build (ignoreBuildErrors: process.env.DAISY_IMAGE_BUILD === '1'), and only the Dockerfile build stage may set DAISY_IMAGE_BUILD=1; CI typechecks every deployed commit";
}

/**
 * fly.toml and fly.migrate.toml build apps/web/Dockerfile's default target,
 * its last stage, so the web `runtime` stage must stay last; the service
 * stages are selected only by their own build-target (ISSUE-528).
 */
export function findDefaultStageProblem(dockerfile: string): string | null {
  const stages = [
    ...uncommented(dockerfile).matchAll(/^FROM \S+ AS (\S+)\s*$/gm),
  ];
  return stages.at(-1)?.[1] === 'runtime'
    ? null
    : 'apps/web/Dockerfile must end with the `runtime` stage: fly.toml and fly.migrate.toml build the default (last) target';
}

/**
 * Each `run:` step's shell text as the shell receives it: a folded (`>`)
 * block joins its lines with spaces, and a literal (`|`) block joins
 * backslash-continued lines. Full-line comments are dropped first.
 */
const runScripts = (workflow: string): string[] => {
  const lines = uncommented(workflow).split('\n');
  return lines.flatMap((line, index) => {
    const step = line.match(/^(\s*)(?:- )?run:\s*(.*)$/);
    if (!step) return [];
    const [, indent = '', style = ''] = step;
    if (!/^[>|][-+]?$/.test(style)) return [style];
    const end = lines.findIndex(
      (next, at) =>
        at > index && next.trim() !== '' && next.search(/\S/) <= indent.length,
    );
    const body = lines
      .slice(index + 1, end === -1 ? undefined : end)
      .map((next) => next.trim());
    return [
      style.startsWith('>')
        ? body.join(' ')
        : body.join('\n').replace(/\\\n/g, ' '),
    ];
  });
};

/** Each `fly deploy`/`flyctl deploy` command, trailing shell comment cut. */
const deployCommands = (workflow: string): string[][] =>
  runScripts(workflow)
    .flatMap((script) => script.split('\n'))
    .filter((command) => /\bfly(?:ctl)? deploy\b/.test(command))
    .map((command) => command.replace(/(?:^|\s)#.*$/, '').split(/\s+/));

/**
 * ISSUE-542: deploy-staging builds every image on the GitHub runner, whose
 * Docker cache the job's builds share. Fly's 4-CPU Depot builder stalled
 * next build's page-data workers for 40 minutes, until the builder dropped
 * the connection; the same build takes about 30 s with room. flyctl
 * defaults to the remote builder, so each deploy command, read whole
 * (ISSUE-544), must say --local-only and nothing that builds remotely.
 */
export function findRunnerBuildProblem(workflow: string): string | null {
  const deploys = deployCommands(workflow);
  return deploys.length > 0 &&
    deploys.every(
      (words) =>
        words.includes('--local-only') &&
        !words.some((word) =>
          /^--(?:remote-only|depot|local-only=)/.test(word),
        ),
    )
    ? null
    : "deploy-staging.yml must build every image on the runner (`flyctl deploy ... --local-only`): Fly's 4-CPU Depot builder stalls next build's page-data workers";
}
