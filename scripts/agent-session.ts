/**
 * The edge of "who is an agent" (ADR 0035 section 6): the registry lives in
 * the main checkout, found from git, never from PU_PROJECT_ROOT or GIT_*.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { isAgentSession } from './agent-guard-rules';
import { readRegistration } from './agent-registry';

function readRecordFile(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return undefined;
    throw error;
  }
}

// GIT_DIR and friends would point git at a repository of the caller's choice.
const withoutGitVariables = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && !entry[0].startsWith('GIT_'),
    ),
  );

/** The main checkout of the repository at cwd; undefined if git cannot say. */
export function mainCheckoutOf(
  cwd: string,
  timeoutMs = 5_000,
): string | undefined {
  const result = Bun.spawnSync(
    ['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'],
    {
      cwd,
      env: withoutGitVariables(),
      stdout: 'pipe',
      stderr: 'ignore',
      // A hung git reads as unknown, which fails closed.
      timeout: timeoutMs,
    },
  );
  const commonDir = result.stdout.toString().trim();
  return result.exitCode === 0 && commonDir !== ''
    ? dirname(commonDir)
    : undefined;
}

/**
 * The main checkout of this repository, anchored to this script's location
 * so running a script from another git repository cannot redirect the lookup.
 */
export const thisRepoMainCheckout = (): string | undefined =>
  mainCheckoutOf(resolve(import.meta.dir, '..'));

/** Whether this process is an agent; an unknown main checkout fails closed. */
export const sessionIsAgent = (
  env: Readonly<Record<string, string | undefined>>,
  mainCheckout: string | undefined,
): boolean =>
  isAgentSession(env, (agentId) =>
    mainCheckout === undefined
      ? 'unreadable'
      : readRegistration(mainCheckout, agentId, readRecordFile),
  );
