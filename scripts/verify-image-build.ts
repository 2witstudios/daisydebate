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

/** A block scalar header: `>` or `|`, its indicators, an optional comment. */
const BLOCK_SCALAR = /^[>|](?:[1-9][-+]?|[-+][1-9]?)?(?:\s+#.*)?$/;

/** YAML folding: adjacent lines join with a space, a blank line is a newline. */
const folded = (lines: readonly string[]) =>
  lines
    .join('\n')
    .replace(/([^\n])\n(?=[^\n])/g, '$1 ')
    .replace(/\n\n/g, '\n');

/**
 * Each `run:` step's shell text as the shell receives it: a folded (`>`)
 * block is folded, a literal (`|`) block kept line by line. Full-line
 * comments are dropped first.
 */
const runScripts = (workflow: string): string[] => {
  const lines = uncommented(workflow).split('\n');
  return lines.flatMap((line, index) => {
    const step = line.match(/^(\s*)(?:- )?run:\s*(.*)$/);
    if (!step) return [];
    const [, indent = '', style = ''] = step;
    if (!BLOCK_SCALAR.test(style)) return [style];
    const end = lines.findIndex(
      (next, at) =>
        at > index && next.trim() !== '' && next.search(/\S/) <= indent.length,
    );
    const body = lines
      .slice(index + 1, end === -1 ? undefined : end)
      .map((next) => next.trim());
    return [style.startsWith('>') ? folded(body) : body.join('\n')];
  });
};

type Lexed = {
  readonly commands: readonly (readonly string[])[];
  readonly words: readonly string[];
  readonly word: string | null;
  readonly quote: string | null;
  readonly comment: boolean;
};

const endWord = (state: Lexed): Lexed =>
  state.word === null
    ? state
    : { ...state, words: [...state.words, state.word], word: null };

const endCommand = (state: Lexed): Lexed => {
  const ended = endWord(state);
  return { ...ended, commands: [...ended.commands, ended.words], words: [] };
};

/** One shell character: quotes, comments, separators and word breaks. */
const lex = (state: Lexed, char: string): Lexed => {
  if (state.comment)
    return char === '\n' ? endCommand({ ...state, comment: false }) : state;
  if (state.quote !== null)
    return char === state.quote
      ? { ...state, quote: null }
      : { ...state, word: `${state.word}${char}` };
  if (char === "'" || char === '"')
    return { ...state, quote: char, word: state.word ?? '' };
  if (char === '#' && state.word === null) return { ...state, comment: true };
  if (/[;&|\n]/.test(char)) return endCommand(state);
  if (/\s/.test(char)) return endWord(state);
  return { ...state, word: `${state.word ?? ''}${char}` };
};

/**
 * A script's simple commands as the shell splits them, quotes removed:
 * `;`, `&&`, `||`, `|` and newlines separate commands, a `#` that starts
 * a word comments to the line end, and backslash-newline continues.
 */
const shellCommands = (script: string): string[][] =>
  endCommand(
    [...script.replace(/\\\n/g, ' ')].reduce(lex, {
      commands: [],
      words: [],
      word: null,
      quote: null,
      comment: false,
    }),
  )
    .commands.filter((words) => words.length > 0)
    .map((words) => [...words]);

/** Each `fly deploy`/`flyctl deploy` command in the workflow, as words. */
const deployCommands = (workflow: string): string[][] =>
  runScripts(workflow)
    .flatMap(shellCommands)
    .filter((words) =>
      words.some(
        (word, at) =>
          (word === 'fly' || word === 'flyctl') && words[at + 1] === 'deploy',
      ),
    );

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
