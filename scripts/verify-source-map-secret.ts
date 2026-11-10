import { uncommented } from './deploy-config-text';
import { deployCommandsIn } from './verify-image-build';

export const SOURCE_MAP_SECRET_PROBLEM =
  'The Sentry source-map token must reach only the web image\'s next build, as a BuildKit secret: apps/web/Dockerfile\'s build stage takes ARG GIT_COMMIT and mounts --mount=type=secret,id=SENTRY_AUTH_TOKEN on its build RUN, nothing makes SENTRY_AUTH_TOKEN an ARG, ENV or --build-arg, and in deploy-staging.yml exactly the steps that build the web image (fly.toml, fly.migrate.toml) hold it in their step env and pass --build-secret SENTRY_AUTH_TOKEN="$SENTRY_AUTH_TOKEN"';

const TOKEN = 'SENTRY_AUTH_TOKEN';
const STEP_ENV = '${{ secrets.SENTRY_AUTH_TOKEN }}';
/** The configs that build apps/web/Dockerfile's default target, whose build stage runs next build. */
const WEB_CONFIGS: ReadonlySet<string> = new Set([
  'fly.toml',
  'fly.migrate.toml',
]);

/** The Dockerfile with comments dropped and each instruction on one line. */
const instructions = (dockerfile: string) =>
  uncommented(dockerfile).replace(/\\\n\s*/g, ' ');

/** The `FROM deps AS build` stage, up to the next stage. */
const buildStage = (docker: string) =>
  docker.match(/^FROM deps AS build\s*$([\s\S]*?)(?=^FROM )/m)?.[1] ?? '';

const dockerfileHolds = (dockerfile: string) => {
  const docker = instructions(dockerfile);
  if (new RegExp(`^(?:ARG|ENV)\\s+${TOKEN}\\b`, 'm').test(docker)) return false;
  const stage = buildStage(docker);
  const run = stage
    .split('\n')
    .find((line) => /^RUN .*bun run --cwd apps\/web build/.test(line));
  return (
    /^ARG GIT_COMMIT\b/m.test(stage) &&
    run !== undefined &&
    run.includes(`--mount=type=secret,id=${TOKEN}`) &&
    run.includes(`/run/secrets/${TOKEN}`) &&
    run.includes('GIT_COMMIT="$GIT_COMMIT"')
  );
};

/** The fly config a deploy command reads: `-c`/`--config`, else fly.toml. */
const configOf = (words: readonly string[]) => {
  const at = words.findIndex((word) => word === '-c' || word === '--config');
  return at === -1 ? 'fly.toml' : (words[at + 1] ?? '');
};

/** Whether a command passes the token's value after `flag`. */
const passes = (words: readonly string[], flag: string) =>
  words.some(
    (word, at) =>
      word === flag && (words[at + 1] ?? '').startsWith(`${TOKEN}=`),
  );

type Env = Readonly<Record<string, unknown>> | undefined;
type Step = { readonly run?: unknown; readonly env?: Env };
type Workflow = {
  readonly env?: Env;
  readonly jobs?: Readonly<
    Record<string, { readonly env?: Env; readonly steps?: readonly Step[] }>
  >;
};

/** One step's verdict and the web configs its deploys build. */
const stepVerdict = (step: Step) => {
  const deploys =
    typeof step.run === 'string' ? deployCommandsIn(step.run) : [];
  const web = deploys.filter((words) => WEB_CONFIGS.has(configOf(words)));
  const built = web.map(configOf);
  if (deploys.some((words) => passes(words, '--build-arg')))
    return { holds: false, built };
  if (web.length === 0)
    return {
      holds:
        step.env?.[TOKEN] === undefined &&
        !deploys.some((words) => passes(words, '--build-secret')),
      built,
    };
  return {
    holds:
      step.env?.[TOKEN] === STEP_ENV &&
      web.every(
        (words) =>
          words.includes(`${TOKEN}=$${TOKEN}`) &&
          passes(words, '--build-secret'),
      ),
    built,
  };
};

const parse = (text: string): Workflow | null => {
  try {
    return (Bun.YAML.parse(text) ?? {}) as Workflow;
  } catch {
    return null;
  }
};

const workflowHolds = (text: string) => {
  const workflow = parse(text);
  if (workflow === null || workflow.env?.[TOKEN] !== undefined) return false;
  const jobs = Object.values(workflow.jobs ?? {});
  if (jobs.some((job) => job.env?.[TOKEN] !== undefined)) return false;
  const verdicts = jobs.flatMap((job) => job.steps ?? []).map(stepVerdict);
  const built = new Set(verdicts.flatMap((verdict) => verdict.built));
  return (
    verdicts.every((verdict) => verdict.holds) &&
    [...WEB_CONFIGS].every((config) => built.has(config))
  );
};

/**
 * next.config.ts uploads only with the token, deletes the browser maps after
 * upload, keeps the plugin's own telemetry off and names the release from the
 * image's GIT_COMMIT.
 */
const nextConfigHolds = (nextConfig: string) => {
  const config = uncommented(nextConfig);
  return [
    /disable:\s*!process\.env\.SENTRY_AUTH_TOKEN\b/,
    /deleteSourcemapsAfterUpload:\s*true\b/,
    /telemetry:\s*false\b/,
    /sentryRelease\(process\.env\.GIT_COMMIT\)/,
  ].every((rule) => rule.test(config));
};

/**
 * ADR 0037 source maps (ADR 0019 secret ownership): the upload token is a
 * deploy-time secret that only the web image's `next build` may read. A
 * BuildKit secret mount never reaches a layer, the image history or its
 * config, unlike an ARG or ENV. Both deploy steps that build the web image
 * pass it, because BuildKit secrets never key the layer cache and the
 * migrator's build is the one the web deploy reuses. No other step holds it.
 * The build config uploads only with it and never leaves a browser map to
 * serve.
 */
export function findSourceMapSecretProblem(input: {
  readonly dockerfile: string;
  readonly workflow: string;
  readonly nextConfig: string;
}): string | null {
  return dockerfileHolds(input.dockerfile) &&
    workflowHolds(input.workflow) &&
    nextConfigHolds(input.nextConfig)
    ? null
    : SOURCE_MAP_SECRET_PROBLEM;
}
