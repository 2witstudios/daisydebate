/**
 * Machine-local spawn capacity (ADR 0035 section 8). How many builders a
 * machine runs at once is its own capacity, not a repository decision, so
 * the cap lives in the main checkout's `.pu/daisy/caps.json`, beside the
 * agent registry and outside every worktree, where the guard refuses agent
 * edits. Absent, the wrapper's default applies.
 *
 *   bun agent:cap <n>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isAgentSession } from './agent-guard-rules';
import type { SpawnDeps } from './agent-spawn';

const CAPS_FILE = '.pu/daisy/caps.json';
const CAP_USAGE = 'usage: bun agent:cap <positive integer>';

export const capsPath = (mainCheckout: string): string =>
  join(mainCheckout, CAPS_FILE);

export type MachineCaps = { readonly builder?: number };

const isCap = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 1;

/** The machine's caps from the file's text; a malformed file is refused, never guessed at. */
export function parseMachineCaps(
  text: string | undefined,
): MachineCaps | { readonly error: string } {
  if (text === undefined) return {};
  const refused = {
    error: `${CAPS_FILE} must be {"builder": <positive integer>}; fix it or run bun agent:cap <n>`,
  };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return refused;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    return refused;
  const entries = Object.entries(parsed);
  const valid = entries.every(
    ([key, value]) => key === 'builder' && isCap(value),
  );
  return valid ? (parsed as MachineCaps) : refused;
}

/** `bun agent:cap <n>`: the owner sets this machine's builder cap; an agent cannot. */
export function setBuilderCap(
  deps: Pick<SpawnDeps, 'autonomous' | 'mainCheckout' | 'write' | 'out'>,
  args: readonly string[],
): number {
  if (deps.autonomous) {
    deps.out('Only the owner sets the machine builder cap.\n');
    return 1;
  }
  const cap = Number(args[0]);
  if (args.length !== 1 || !isCap(cap)) {
    deps.out(`${CAP_USAGE}\n`);
    return 2;
  }
  deps.write(
    capsPath(deps.mainCheckout),
    `${JSON.stringify({ builder: cap }, null, 2)}\n`,
  );
  deps.out(`builder cap for this machine: ${cap}\n`);
  return 0;
}

if (import.meta.main) {
  const commonDir = Bun.spawnSync(
    ['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'],
    { stdout: 'pipe' },
  );
  process.exitCode = setBuilderCap(
    {
      autonomous: isAgentSession(process.env),
      mainCheckout: dirname(commonDir.stdout.toString().trim()),
      write: (path, text) => {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, text);
      },
      out: (text) => process.stdout.write(text),
    },
    process.argv.slice(2),
  );
}
