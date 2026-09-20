import { agentSeedUsers, agentSeedVersion } from './agent-seed';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');

export type AgentCredential = {
  readonly username: string;
  readonly userId: string;
};

export type ReadinessOptions = {
  readonly fetch?: typeof globalThis.fetch;
  readonly delay?: (milliseconds: number) => Promise<void>;
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
};

export function formatAgentReady({
  appUrl,
  credentials,
  seedVersion,
}: {
  readonly appUrl: string;
  readonly credentials: readonly AgentCredential[];
  readonly seedVersion: string;
}): string {
  return [
    'Daisy agent development ready',
    `Web: ${appUrl}`,
    `Health: ${appUrl}/api/health/ready`,
    'Credentials:',
    ...credentials.map(({ username, userId }) => `  ${username} (${userId})`),
    `Seed version: ${seedVersion}`,
    '',
  ].join('\n');
}

export async function waitForReadiness(
  url: string,
  {
    fetch = globalThis.fetch,
    delay = (milliseconds) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
    timeoutMs = 60_000,
    intervalMs = 250,
  }: ReadinessOptions = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (response.ok) return;
    } catch {
      // The web process may still be starting or compiling its first request.
    }
    if (Date.now() >= deadline)
      throw new Error(`Web readiness timed out after ${timeoutMs}ms`);
    await delay(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
  }
}

type Command = 'infra:up' | 'db:migrate' | 'db:seed';

async function runCommand(command: Command, quiet = false): Promise<void> {
  const child = Bun.spawn(['bun', 'run', command], {
    cwd: root,
    stdin: 'inherit',
    stdout: quiet ? 'ignore' : 'inherit',
    stderr: 'inherit',
  });
  const exitCode = await child.exited;
  if (exitCode !== 0)
    throw new Error(`${command} failed with exit code ${exitCode}`);
}

async function main(): Promise<void> {
  await runCommand('infra:up');
  await runCommand('db:migrate');
  await runCommand('db:seed', true);

  const appUrl = process.env.PUBLIC_APP_URL ?? 'http://localhost:3000';
  const web = Bun.spawn(['bun', 'run', 'dev'], {
    cwd: root,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const stopWeb = () => web.kill('SIGTERM');
  process.once('SIGINT', stopWeb);
  process.once('SIGTERM', stopWeb);
  try {
    await waitForReadiness(`${appUrl}/api/health/ready`);
    process.stdout.write(
      formatAgentReady({
        appUrl,
        credentials: agentSeedUsers,
        seedVersion: agentSeedVersion,
      }),
    );
    await web.exited;
  } finally {
    process.removeListener('SIGINT', stopWeb);
    process.removeListener('SIGTERM', stopWeb);
    if (web.exitCode === null) web.kill('SIGTERM');
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Agent development failed'}\n`,
    );
    process.exitCode = 1;
  }
}
