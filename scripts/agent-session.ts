/**
 * The edge of "who is an agent" (ADR 0035 section 6): reads the main
 * checkout's agent registry, never the worktree's, and never trusts
 * PU_PROJECT_ROOT, which any process can set.
 */
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { isAgentSession } from './agent-guard-rules';
import { readRegistration } from './agent-registry';

function readRecordFile(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** The parent of the git common dir of cwd; undefined when git cannot say or times out. */
export function mainCheckoutOf(
  cwd: string,
  timeoutMs = 5_000,
): string | undefined {
  const result = Bun.spawnSync(
    ['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'],
    {
      cwd,
      env: process.env,
      stdout: 'pipe',
      stderr: 'ignore',
      // A hung git reads as unknown, which fails closed, instead of blocking.
      timeout: timeoutMs,
    },
  );
  const commonDir = result.stdout.toString().trim();
  return result.exitCode === 0 && commonDir !== ''
    ? dirname(commonDir)
    : undefined;
}

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
