#!/usr/bin/env bun
/**
 * Shows that the bot's nets catch what they claim to (R4.3): each mutation
 * below breaks the bot publisher or speaker, and the run prints which net
 * catches it: the round-bots unit tests, the bot corpus, or the generated
 * walks. Every mutation must be caught, and some only by a walk. Run it by
 * hand through the heavy queue: `bun bots:sabotage` (`--only <name>` runs
 * one).
 *
 * It runs against the committed HEAD in a temporary git worktree, never the
 * checkout: each mutation is applied there, checked and reverted before the
 * next, and the worktree is removed at the end. A mutation whose text no
 * longer occurs once is a failure: the bot moved, so the mutation must be
 * re-aimed, never skipped.
 */
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

type Mutation = {
  readonly name: string;
  readonly file: string;
  readonly find: string;
  readonly replace: string;
};

const bots = 'apps/web/src/features/round-bots';

const mutations: readonly Mutation[] = [
  {
    name: 'a retried end credits the whole phrase',
    file: `${bots}/model/line-ledger.ts`,
    find: "          line.ending.status === 'open' ? { kind: 'whole' } : line.ending.end,",
    replace: "          { kind: 'whole' },",
  },
  {
    name: 'a cleared tail is still credited',
    file: `${bots}/model/line-ledger.ts`,
    find: '    Math.max(0, input.sentSamples - dropped) / input.phraseSamples,',
    replace: '    Math.max(0, input.sentSamples) / input.phraseSamples,',
  },
  {
    name: 'frames play past the hard stop',
    file: `${bots}/model/publisher.ts`,
    find: "  emit(step, { type: 'write', stopAtMs: playing.stopAtMs });",
    replace:
      "  emit(step, { type: 'write', stopAtMs: playing.stopAtMs + 100 });",
  },
  {
    name: 'a start backing off is asked again after the claim ended',
    file: `${bots}/model/publisher.ts`,
    find: "    if (args.kind !== 'end' && last) {",
    replace: '    if (false) {',
  },
  {
    name: 'a refused start still plays',
    file: `${bots}/model/publisher.ts`,
    find: "      const outcome = failure ?? ('granted' as const);",
    replace: "      const outcome = 'granted' as const;",
  },
  {
    name: 'a played line is never closed',
    file: `${bots}/model/publisher.ts`,
    find: '  const ending = lineRevealed(step.state.lines, id)',
    replace: '  const ending = false',
  },
  {
    name: 'a phrase voiced ahead is bought again',
    file: `${bots}/model/speech-state.ts`,
    find: "        return !voice || voice.status === 'failed';",
    replace: "        return !voice || voice.status !== 'settled';",
  },
  {
    name: 'a phrase is skipped',
    file: `${bots}/model/speech-state.ts`,
    find: '        cursor: turn.cursor + 1,',
    replace: '        cursor: turn.cursor + (turn.cursor === 1 ? 2 : 1),',
  },
  {
    name: 'a replayed turn is answered again',
    file: `${bots}/duty.ts`,
    find: '    event.spokeUntilMs <= state.answeredThroughMs',
    replace: '    event.spokeUntilMs < state.answeredThroughMs',
  },
  {
    name: 'cross-examination speaks over a peer mid-turn',
    file: `${bots}/speaker.ts`,
    find: '          if (crossEx) await floorClear(signal);',
    replace: '',
  },
  {
    name: 'a retry pause never wakes the speaker',
    file: `${bots}/speaker.ts`,
    find: '          : selfWake.pauseFor(retryPauseMs(state.duty));',
    replace: '          : undefined;',
  },
  {
    name: 'a pause outlives the turn it held',
    file: `${bots}/speaker.ts`,
    find: '      selfWake.stopPause();\n',
    replace: '',
  },
  {
    name: 'a turn reported again while answered is answered again',
    file: `${bots}/duty.ts`,
    find: '    duty.to.spokeUntilMs >= event.spokeUntilMs',
    replace: '    duty.to.spokeUntilMs > event.spokeUntilMs',
  },
];

const checkout = resolve(import.meta.dir, '..');
/** Longer than any net takes unmutated, which is seconds. */
const NET_TIMEOUT_MS = 120_000;

type Run = { readonly ok: boolean; readonly output: string };

const run = (cmd: readonly string[], cwd: string): Run => {
  const result = Bun.spawnSync([...cmd], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    // A mutation can leave work that never settles: a net that hangs caught it.
    timeout: NET_TIMEOUT_MS,
  });
  return {
    ok: result.exitCode === 0,
    output: `${result.stdout.toString()}${result.stderr.toString()}`,
  };
};

const NETS = ['unit tests', 'corpus', 'walks'] as const;
type Net = (typeof NETS)[number];

/** The test files of each net, relative to `apps/web`. */
const netFiles = (root: string): Record<Net, readonly string[]> => {
  const folder = resolve(root, bots);
  const tests = [
    ...readdirSync(folder).map((name) => `src/features/round-bots/${name}`),
    ...readdirSync(join(folder, 'model')).map(
      (name) => `src/features/round-bots/model/${name}`,
    ),
  ].filter((path) => path.endsWith('.test.ts'));
  const corpus = 'src/features/round-bots/bot-corpus.test.ts';
  const walks = 'src/features/round-bots/bot-walks.test.ts';
  return {
    'unit tests': tests.filter((path) => path !== corpus && path !== walks),
    corpus: [corpus],
    walks: [walks],
  };
};

const check = (root: string, mutation: Mutation) => {
  const path = resolve(root, mutation.file);
  const original = readFileSync(path, 'utf8');
  const occurrences = original.split(mutation.find).length - 1;
  if (occurrences !== 1)
    return {
      problem: `${mutation.name}: its text occurs ${occurrences} times in ${mutation.file}; re-aim it`,
      caught: [],
    };
  writeFileSync(path, original.replace(mutation.find, mutation.replace));
  try {
    const files = netFiles(root);
    const caught = NETS.filter(
      (net) =>
        !run(['bun', 'test', ...files[net]], resolve(root, 'apps/web')).ok,
    );
    return {
      problem:
        caught.length === 0 ? `${mutation.name}: no net catches it` : null,
      caught,
    };
  } finally {
    writeFileSync(path, original);
  }
};

if (import.meta.main) {
  const only = process.argv.indexOf('--only');
  const chosen =
    only === -1
      ? mutations
      : mutations.filter(({ name }) => name === process.argv[only + 1]);
  if (chosen.length === 0) {
    console.error('No mutation matches');
    process.exit(1);
  }
  const scratch = mkdtempSync(join(tmpdir(), 'bots-sabotage-'));
  const git = (...args: string[]) => run(['git', ...args], checkout);
  const remove = () => git('worktree', 'remove', '--force', scratch);
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => {
      remove();
      process.exit(130);
    });
  const added = git('worktree', 'add', '--detach', scratch, 'HEAD');
  if (!added.ok) throw new Error(added.output);
  const problems: string[] = [];
  let walkOnly = 0;
  try {
    const installed = run(['bun', 'install', '--frozen-lockfile'], scratch);
    if (!installed.ok) throw new Error(installed.output);
    console.log(`| Mutation | ${NETS.join(' | ')} |`);
    console.log(`|---|${NETS.map(() => '---').join('|')}|`);
    for (const mutation of chosen) {
      const { problem, caught } = check(scratch, mutation);
      if (problem) problems.push(problem);
      if (caught.length === 1 && caught[0] === 'walks') walkOnly += 1;
      console.log(
        `| ${mutation.name} | ${NETS.map((net) => (caught.includes(net) ? 'caught' : '—')).join(' | ')} |`,
      );
    }
  } finally {
    remove();
  }
  if (only === -1 && walkOnly === 0)
    problems.push('no mutation is caught only by a walk');
  for (const problem of problems) console.error(`NOT SHOWN  ${problem}`);
  process.exit(problems.length === 0 ? 0 : 1);
}
