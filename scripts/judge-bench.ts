/**
 * `bun judge:bench`: a local workbench for the AI judge. Pull one played
 * Round from a deployed environment (read-only), write its fully assembled
 * judging prompt into one editable file, then re-run that file as often as
 * you like and compare the ballots. Everything lands in `.evals/judging/`,
 * which is gitignored: transcripts are user data and stay on this machine.
 *
 *   bun judge:bench pull <roundId> [--app daisy-debate-staging]
 *   bun judge:bench init [roundId] [--force]
 *   bun judge:bench run  [roundId] [-n 3] [--prompt <file>] [--label <name>]
 *   bun judge:bench diff <runA> <runB> [--round <roundId>]
 *
 * roundId defaults to the most recently pulled Round.
 */
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  ballotWireSchema,
  createOpenRouter,
  judgeAnswer,
  type TranscriptEvidenceInput,
} from '@daisy/ai-voice';
import { transcriptEvidenceInput } from '../apps/web/src/features/round-runtime/transcript-evidence';
import {
  expand,
  parsePromptFile,
  renderPromptFile,
  type CallOptions,
} from './judge-bench/prompt-file';
import { placeholdersFor, productionPrompt } from './judge-bench/evidence';

const ROOT = '.evals/judging';
const MARK = 'JUDGE_BENCH_JSON:';

type Stored = {
  readonly roundId: string;
  readonly model: string;
  readonly evidence: TranscriptEvidenceInput;
};
type Ballotish = {
  winner?: string;
  scores?: Record<string, Record<string, number>>;
  reason?: string;
  feedback?: Record<string, string>;
};

const roundDir = (id: string) => join(ROOT, id);
const latestRound = () => {
  const dirs = existsSync(ROOT)
    ? readdirSync(ROOT).filter((name) =>
        existsSync(join(ROOT, name, 'round.json')),
      )
    : [];
  const latest = dirs.sort(
    (a, b) => statSync(join(ROOT, b)).mtimeMs - statSync(join(ROOT, a)).mtimeMs,
  )[0];
  if (!latest)
    throw new Error(
      'no pulled Round: run `bun judge:bench pull <roundId>` first',
    );
  return latest;
};
const readRound = async (id: string): Promise<Stored> =>
  Bun.file(join(roundDir(id), 'round.json')).json();

const schemaRequest = (schema: CallOptions['schema']) =>
  schema === 'ballot'
    ? { outputSchema: { name: 'ballot', schema: ballotWireSchema } }
    : schema === 'json'
      ? { json: true }
      : {};

const total = (scores: Record<string, number> | undefined) =>
  scores ? Object.values(scores).reduce((sum, value) => sum + value, 0) : NaN;

function ballotSummary(ballot: Ballotish): string {
  const aff = total(ballot.scores?.['affirmative']);
  const neg = total(ballot.scores?.['negative']);
  return [
    `**${ballot.winner ?? '?'}** · AFF ${aff} – NEG ${neg}`,
    '',
    ballot.reason ?? '',
    ...(ballot.feedback
      ? [
          '',
          `AFF: ${ballot.feedback['affirmative'] ?? ''}`,
          `NEG: ${ballot.feedback['negative'] ?? ''}`,
        ]
      : []),
  ].join('\n');
}

type Review = {
  findings?: {
    check?: string;
    ballotSaid?: string;
    transcript?: string;
    error?: boolean;
  }[];
  changed?: boolean;
  ballot?: Ballotish;
};

const parsed = (text: string): (Ballotish & Review) | null => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** A ballot as its summary; a review as its findings and its final ballot; anything else as text. */
const sideScores = (ballot: Ballotish, side: string) =>
  ballot.scores?.[side] ?? {};
const keySet = (scores: Record<string, number>) =>
  Object.keys(scores).sort().join(',');
const allInRange = (ballot: Ballotish) =>
  ['affirmative', 'negative']
    .flatMap((side) => Object.values(sideScores(ballot, side)))
    .every((score) => Number.isInteger(score) && score >= 1 && score <= 5);
const tooLong = (text: string | undefined, limit: number) =>
  (text ?? '').length > limit;

/** What makes a ballot of any category set unusable: winner, 10 matching 1-5 scores per side, length limits. */
function ballotShapeIssues(ballot: Ballotish): string[] {
  const aff = sideScores(ballot, 'affirmative');
  const neg = sideScores(ballot, 'negative');
  const checks: [boolean, string][] = [
    [!['affirmative', 'negative'].includes(ballot.winner ?? ''), 'no winner'],
    [
      keySet(aff) !== keySet(neg),
      'the sides are scored on different categories',
    ],
    [Object.keys(aff).length !== 10, 'not 10 categories'],
    [!allInRange(ballot), 'a score outside 1-5'],
    [tooLong(ballot.reason, 600), `reason ${(ballot.reason ?? '').length}/600`],
    [
      tooLong(ballot.feedback?.['affirmative'], 280),
      'affirmative feedback over 280',
    ],
    [tooLong(ballot.feedback?.['negative'], 280), 'negative feedback over 280'],
  ];
  return checks.filter(([failed]) => failed).map(([, issue]) => issue);
}

function renderOutput(text: string): string {
  const value = parsed(text);
  if (value?.winner) {
    const issues = ballotShapeIssues(value);
    return `${ballotSummary(value)}${issues.length ? `\n\nUNUSABLE BALLOT: ${issues.join('; ')}` : ''}`;
  }
  if (!value?.ballot) return text;
  const findings = (value.findings ?? []).map(
    (finding) =>
      `- ${finding.error ? 'ERROR' : 'ok'} · ${finding.check ?? ''}: "${finding.ballotSaid ?? ''}" → ${finding.transcript ?? ''}`,
  );
  const accepted = judgeAnswer({
    text: JSON.stringify(value.ballot),
    finish: 'stop',
    refused: false,
  }).ok;
  return [
    `**Review** · ${value.changed ? 'ballot changed' : 'ballot kept'}${accepted ? '' : ' · production would REJECT the final ballot'}`,
    '',
    ...findings,
    '',
    '**Final ballot**',
    '',
    ballotSummary(value.ballot),
  ].join('\n');
}

async function pull(roundId: string, app: string) {
  const script = await Bun.file('scripts/judge-bench/remote-read.ts').text();
  const encoded = Buffer.from(script).toString('base64');
  // The machine resolves @daisy/db and drizzle-orm from packages/db; the file is removed after.
  const remote = `cd /app/packages/db && echo ${encoded} | base64 -d > .jb-read.ts && JB_ROUND=${roundId} bun .jb-read.ts; status=$?; rm -f .jb-read.ts; exit $status`;
  const proc = Bun.spawn(
    ['fly', 'ssh', 'console', '-a', app, '-C', `sh -c '${remote}'`],
    {
      stdout: 'pipe',
      stderr: 'inherit',
    },
  );
  const out = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) throw new Error('the remote read failed');
  const line = out.split('\n').find((row) => row.startsWith(MARK));
  if (!line) throw new Error('the remote read printed no result');
  const raw = JSON.parse(line.slice(MARK.length));
  if (!raw.frozen) throw new Error('this Round has no transcript freeze');
  const evidence = transcriptEvidenceInput({
    round: raw.round,
    frozen: raw.frozen,
  });
  const ballots = raw.ballots as (Ballotish & { model: string | null })[];
  const model =
    ballots.find((ballot) => ballot.model)?.model ??
    'anthropic/claude-sonnet-5.5';
  mkdirSync(roundDir(roundId), { recursive: true });
  await Bun.write(
    join(roundDir(roundId), 'round.json'),
    JSON.stringify({ roundId, model, evidence } satisfies Stored, null, 2),
  );
  await Bun.write(
    join(roundDir(roundId), 'baseline.md'),
    [
      `# Production ballots for ${roundId}`,
      `Resolution: ${evidence.resolution}`,
      '',
    ]
      .concat(
        ballots.map(
          (ballot, at) =>
            `## Judge ${at + 1} (${ballot.model ?? 'human'})\n\n${ballotSummary(ballot)}\n`,
        ),
      )
      .join('\n'),
  );
  console.log(
    `pulled ${evidence.utterances.length} lines, ${ballots.length} ballot(s) → ${roundDir(roundId)}`,
  );
}

async function init(roundId: string, force: boolean) {
  const target = join(roundDir(roundId), 'prompt.md');
  if (existsSync(target) && !force)
    throw new Error(
      `${target} exists; pass --force to rebuild it from production code`,
    );
  const stored = await readRound(roundId);
  const { messages, evidence } = productionPrompt(stored.evidence);
  const options: CallOptions = {
    model: stored.model,
    reasoning: 'medium',
    maxTokens: 6000,
    schema: 'ballot',
  };
  await Bun.write(target, renderPromptFile({ messages, evidence, options }));
  console.log(`wrote ${target}`);
}

async function run(
  roundId: string,
  count: number,
  promptPath: string | undefined,
  label?: string,
) {
  const apiKey = process.env['OPENROUTER_API_KEY'];
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set in .env');
  const stored = await readRound(roundId);
  const path = promptPath ?? join(roundDir(roundId), 'prompt.md');
  const source = await Bun.file(path).text();
  const file = parsePromptFile(source);
  const placeholders = placeholdersFor(stored.evidence);
  const voice = createOpenRouter({ apiKey, fetch, timeoutMs: 300_000 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join(
    roundDir(roundId),
    'runs',
    label ? `${stamp}-${label}` : stamp,
  );
  mkdirSync(dir, { recursive: true });
  await Bun.write(join(dir, 'prompt.md'), source);

  /** One model call of one run; a ballot-schema call is also checked as production would. */
  const callOnce = async (
    call: (typeof file.calls)[number],
    outputs: ReadonlyMap<number, string>,
  ) => {
    const options = { ...file.options, ...call.options };
    const model = options.model ?? stored.model;
    const answer = await voice.complete({
      model,
      messages: call.messages.map((message) => ({
        role: message.role,
        content: expand(message.content, placeholders, outputs),
      })),
      maxTokens: options.maxTokens ?? 6000,
      ...(options.reasoning ? { reasoning: options.reasoning } : {}),
      ...(options.temperature === undefined
        ? {}
        : { temperature: options.temperature }),
      ...schemaRequest(options.schema),
    });
    const check = options.schema === 'ballot' ? judgeAnswer(answer) : null;
    return {
      call: call.number,
      model,
      finish: answer.finish,
      tokens: { input: answer.promptTokens, output: answer.completionTokens },
      text: answer.text,
      ...(check ? { productionAccepts: check.ok } : {}),
      ...(check && !check.ok ? { diagnostic: check.diagnostic } : {}),
    };
  };

  const once = async (index: number) => {
    const outputs = new Map<number, string>();
    const calls = [];
    for (const call of file.calls) {
      const result = await callOnce(call, outputs);
      outputs.set(call.number, result.text);
      calls.push(result);
    }
    const last = calls.at(-1)!;
    const record = { run: index + 1, calls };
    await Bun.write(
      join(dir, `run-${index + 1}.json`),
      JSON.stringify(record, null, 2),
    );
    const head = `## Run ${index + 1}${'productionAccepts' in last ? (last.productionAccepts ? '' : ' — production would REJECT this ballot') : ''}`;
    const sections = calls.map((entry) =>
      calls.length > 1
        ? `### Call ${entry.call}\n\n${renderOutput(entry.text)}\n`
        : `${renderOutput(entry.text)}\n`,
    );
    return [head, '', ...sections].join('\n');
  };

  const settled = await Promise.allSettled(
    Array.from({ length: count }, (_, at) => once(at)),
  );
  const summary = settled
    .map((result, at) =>
      result.status === 'fulfilled'
        ? result.value
        : `## Run ${at + 1} failed\n\n${result.reason instanceof Error ? `${result.reason.message}${result.reason.cause ? ` (${String((result.reason.cause as Error).message ?? result.reason.cause)})` : ''}` : String(result.reason)}\n`,
    )
    .join('\n');
  await Bun.write(join(dir, 'summary.md'), summary);
  console.log(summary);
  console.log(`saved → ${dir}`);
}

async function diff(roundId: string, a: string, b: string) {
  const runs = join(roundDir(roundId), 'runs');
  const resolve = (name: string) =>
    readdirSync(runs).find(
      (entry) => entry === name || entry.startsWith(name),
    ) ??
    (() => {
      throw new Error(`no run ${name} in ${runs}`);
    })();
  const [left, right] = [resolve(a), resolve(b)].map((name) =>
    join(runs, name),
  );
  Bun.spawnSync(
    [
      'git',
      'diff',
      '--no-index',
      '--',
      join(left!, 'prompt.md'),
      join(right!, 'prompt.md'),
    ],
    {
      stdout: 'inherit',
      stderr: 'inherit',
    },
  );
  for (const side of [left!, right!])
    console.log(
      `\n# ${side}\n\n${await Bun.file(join(side, 'summary.md')).text()}`,
    );
}

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    app: { type: 'string', default: 'daisy-debate-staging' },
    force: { type: 'boolean', default: false },
    n: { type: 'string', short: 'n', default: '1' },
    prompt: { type: 'string' },
    label: { type: 'string' },
    round: { type: 'string' },
  },
});
const [command, ...rest] = positionals;
try {
  if (command === 'pull' && rest[0]) await pull(rest[0], values.app!);
  else if (command === 'init')
    await init(rest[0] ?? latestRound(), values.force!);
  else if (command === 'run')
    await run(
      rest[0] ?? latestRound(),
      Number(values.n),
      values.prompt,
      values.label,
    );
  else if (command === 'diff' && rest[0] && rest[1])
    await diff(values.round ?? latestRound(), rest[0], rest[1]);
  else {
    console.log(
      'usage:\n  bun judge:bench pull <roundId> [--app daisy-debate-staging]\n  bun judge:bench init [roundId] [--force]\n  bun judge:bench run [roundId] [-n 3] [--prompt <file>]\n  bun judge:bench diff <runA> <runB> [--round <roundId>]',
    );
    process.exitCode = command ? 1 : 0;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
