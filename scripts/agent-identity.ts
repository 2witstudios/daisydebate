#!/usr/bin/env bun
/**
 * Which GitHub identity a session acts under (ADR 0035). Autonomous agents
 * must act as the machine user from `.env.agent`; the owner's keyring token
 * and SSH key are the owner's alone. `assessAgentEnv` gates the pu launcher
 * and `assessGithubIdentity` is the `github-identity` check of bun doctor.
 */
import { readFileSync } from 'node:fs';
import { parseDotenv } from './dotenv';

type Env = Readonly<Record<string, string | undefined>>;

function gitConfigEntries(env: Env): readonly (readonly [string, string])[] {
  const count = Number(env.GIT_CONFIG_COUNT ?? '0');
  return Array.from({ length: Number.isInteger(count) ? count : 0 }, (_, i) => [
    (env[`GIT_CONFIG_KEY_${i}`] ?? '').toLowerCase(),
    env[`GIT_CONFIG_VALUE_${i}`] ?? '',
  ]);
}

/** Problems that would let an agent act as the owner; empty when safe. */
export function assessAgentEnv(env: Env): readonly string[] {
  const entries = gitConfigEntries(env);
  const has = (key: string, value: (v: string) => boolean) =>
    entries.some(([k, v]) => k === key && value(v));
  const helpers = entries.filter(
    ([key]) => key === 'credential.https://github.com.helper',
  );
  return [
    (env.GH_TOKEN ?? '') === ''
      ? 'GH_TOKEN is empty: gh and git would fall back to the owner keyring token'
      : undefined,
    env.DAISY_AUTONOMOUS === '1' ? undefined : 'DAISY_AUTONOMOUS must be 1',
    has('url.https://github.com/.insteadof', (v) => v === 'git@github.com:')
      ? undefined
      : 'GIT_CONFIG_* must rewrite git@github.com: to HTTPS',
    helpers[0]?.[1] === '' && helpers.at(-1)?.[1] === '!gh auth git-credential'
      ? undefined
      : 'GIT_CONFIG_* must use `gh auth git-credential` as the GitHub credential helper',
    env.GIT_SSH_COMMAND === 'false'
      ? undefined
      : 'GIT_SSH_COMMAND must refuse SSH so the owner key is never used',
  ].filter((problem): problem is string => problem !== undefined);
}

export type IdentityFacts = {
  readonly autonomous: boolean;
  /** The login gh authenticates as; undefined when gh cannot tell. */
  readonly login: string | undefined;
  readonly tokenFromEnv: boolean;
  readonly pushUrl: string | undefined;
  readonly credentialHelper: string | undefined;
  readonly owner: string;
};

export function assessGithubIdentity(facts: IdentityFacts): {
  readonly status: 'pass' | 'fail';
  readonly detail: string;
} {
  if (!facts.autonomous)
    return {
      status: 'pass',
      detail: `owner session as ${facts.login ?? 'an unknown GitHub identity'}`,
    };
  const problems = [
    facts.login === undefined ? 'gh cannot resolve the agent identity' : '',
    facts.login === facts.owner
      ? `DAISY_AUTONOMOUS=1 resolves to the owner ${facts.owner}`
      : '',
    facts.tokenFromEnv ? '' : 'GH_TOKEN is unset, so gh uses the owner keyring',
    facts.pushUrl?.startsWith('https://github.com/')
      ? ''
      : `origin pushes over ${facts.pushUrl ?? 'an unknown URL'}, not HTTPS`,
    facts.credentialHelper === '!gh auth git-credential'
      ? ''
      : 'git does not authenticate through `gh auth git-credential`',
  ].filter(Boolean);
  return problems.length > 0
    ? { status: 'fail', detail: problems.join('; ') }
    : {
        status: 'pass',
        detail: `autonomous as ${facts.login} (GH_TOKEN, HTTPS push)`,
      };
}

if (import.meta.main) {
  const [mode, file] = process.argv.slice(2);
  if (mode !== 'check-env' || !file) {
    process.stderr.write('usage: agent-identity.ts check-env <env file>\n');
    process.exit(2);
  }
  const problems = assessAgentEnv(parseDotenv(readFileSync(file, 'utf8')));
  for (const problem of problems)
    process.stderr.write(`agent-launch: ${problem}\n`);
  process.exit(problems.length > 0 ? 1 : 0);
}
