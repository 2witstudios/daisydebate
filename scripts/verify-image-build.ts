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

type Workflow = {
  readonly jobs?: Record<
    string,
    { readonly steps?: { readonly run?: unknown }[] }
  >;
};

/**
 * Each step's `run:` text exactly as YAML yields it to the shell (folded,
 * literal, plain and quoted scalars alike, ISSUE-548), or null when the
 * workflow is not YAML.
 */
const runScripts = (workflow: string): string[] | null => {
  try {
    const { jobs = {} } = (Bun.YAML.parse(workflow) ?? {}) as Workflow;
    return Object.values(jobs).flatMap((job) =>
      (job.steps ?? []).flatMap(({ run }) =>
        typeof run === 'string' ? [run] : [],
      ),
    );
  } catch {
    return null;
  }
};

type Lexed = {
  readonly commands: readonly (readonly string[])[];
  readonly words: readonly string[];
  readonly word: string | null;
  readonly quote: string | null;
  readonly comment: boolean;
  readonly escaped: boolean;
};

const endWord = (state: Lexed): Lexed =>
  state.word === null
    ? state
    : { ...state, words: [...state.words, state.word], word: null };

const endCommand = (state: Lexed): Lexed => {
  const ended = endWord(state);
  return { ...ended, commands: [...ended.commands, ended.words], words: [] };
};

const append = (state: Lexed, char: string): Lexed => ({
  ...state,
  word: `${state.word ?? ''}${char}`,
  escaped: false,
});

/** A backslash escapes any character outside quotes, and these inside "". */
const ESCAPABLE_IN_DOUBLE_QUOTES = new Set(['"', '\\', '$', '`']);

/** One character inside quotes: the closing quote, an escape, or data. */
const lexQuoted = (state: Lexed, char: string): Lexed => {
  if (state.escaped)
    return append(
      state,
      ESCAPABLE_IN_DOUBLE_QUOTES.has(char) ? char : `\\${char}`,
    );
  if (char === '\\' && state.quote === '"') return { ...state, escaped: true };
  return char === state.quote ? { ...state, quote: null } : append(state, char);
};

/** One shell character: escapes, quotes, comments, separators, word breaks. */
const lex = (state: Lexed, char: string): Lexed => {
  if (state.comment)
    return char === '\n' ? endCommand({ ...state, comment: false }) : state;
  if (state.quote !== null) return lexQuoted(state, char);
  if (state.escaped) return append(state, char);
  if (char === '\\') return { ...state, escaped: true };
  if (char === "'" || char === '"')
    return { ...state, quote: char, word: state.word ?? '' };
  if (char === '#' && state.word === null) return { ...state, comment: true };
  if (/[;&|()\n]/.test(char)) return endCommand(state);
  if (/\s/.test(char)) return endWord(state);
  return append(state, char);
};

/**
 * A script's simple commands as the shell splits them, quotes removed:
 * `;`, `&&`, `||`, `|`, subshell parentheses and newlines separate
 * commands, a `#` that starts a word comments to the line end, a backslash
 * escapes, and backslash-newline continues.
 */
const shellCommands = (script: string): string[][] =>
  endCommand(
    [...script.replace(/\\\n/g, ' ')].reduce(lex, {
      commands: [],
      words: [],
      word: null,
      quote: null,
      comment: false,
      escaped: false,
    }),
  )
    .commands.filter((words) => words.length > 0)
    .map((words) => [...words]);

/** `fly` or `flyctl`, however the command names its path (ISSUE-549). */
const isFly = (word: string) => /(?:^|\/)fly(?:ctl)?$/.test(word);

/** Each `fly deploy`/`flyctl deploy` command, or null when unreadable. */
const deployCommands = (workflow: string): string[][] | null =>
  runScripts(workflow)
    ?.flatMap(shellCommands)
    .filter((words) =>
      words.some((word, at) => isFly(word) && words[at + 1] === 'deploy'),
    ) ?? null;

/**
 * ISSUE-542: deploy-staging builds every image on the GitHub runner, whose
 * Docker cache the job's builds share. Fly's 4-CPU Depot builder stalled
 * next build's page-data workers for 40 minutes, until the builder dropped
 * the connection; the same build takes about 30 s with room. flyctl
 * defaults to the remote builder, so each deploy command, read whole
 * as the shell runs it (ISSUE-544, ISSUE-546), must say --local-only and
 * nothing that builds remotely.
 */
export function findRunnerBuildProblem(workflow: string): string | null {
  const deploys = deployCommands(workflow) ?? [];
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
