import { readFileSync } from 'node:fs';

/** Pure check: does the Dockerfile's base image pin exactly `.bun-version`? */
export function findDockerfileBunVersionProblem(input: {
  readonly dockerfile: string;
  readonly bunVersion: string;
}): string | null {
  const pinned = input.dockerfile.match(/FROM oven\/bun:(\S+) AS base/);
  if (!pinned)
    return 'Dockerfile has no `FROM oven/bun:<version> AS base` line';
  const tag = pinned[1];
  if (tag !== `${input.bunVersion}-slim` && tag !== input.bunVersion)
    return `Dockerfile pins oven/bun:${tag}, but .bun-version is ${input.bunVersion}`;
  return null;
}

// The migration runner path baked into the runtime image by
// apps/web/Dockerfile (packages/db/scripts/migrate.ts, copied alongside
// packages/db/migrations). Changing where the Dockerfile puts the runner
// requires updating this constant too — that coupling is the point: it is
// the one place release_command drift (a no-op command, or a command that
// can't run from the image) gets caught before a release ships unmigrated.
export const EXPECTED_RELEASE_COMMAND =
  'bun /app/packages/db/scripts/migrate.ts';

/**
 * Pure check: does fly.toml's `[deploy]` table keep exactly the required
 * migration release command? Scoped to the `[deploy]` table body so a
 * same-named key under another table, or a commented-out line, cannot
 * satisfy it.
 */
export function findFlyReleaseCommandProblem(flyToml: string): string | null {
  const lines = flyToml.split('\n');
  const deployStart = lines.findIndex((line) => line.trim() === '[deploy]');
  if (deployStart === -1) return 'fly.toml has no `[deploy]` table';
  const bodyLines: string[] = [];
  for (const line of lines.slice(deployStart + 1)) {
    if (/^\[/.test(line.trim())) break;
    if (!line.trim().startsWith('#')) bodyLines.push(line);
  }
  const match = bodyLines.join('\n').match(/release_command\s*=\s*"([^"]*)"/);
  if (!match) return 'fly.toml has no `release_command` under [deploy]';
  const value = match[1].trim();
  if (value === '') return 'fly.toml release_command is empty';
  if (value !== EXPECTED_RELEASE_COMMAND)
    return `fly.toml release_command is "${value}", expected "${EXPECTED_RELEASE_COMMAND}"`;
  return null;
}

export function verifyDeployConfig(input: {
  readonly dockerfile: string;
  readonly flyToml: string;
  readonly bunVersion: string;
}): readonly string[] {
  return [
    findDockerfileBunVersionProblem({
      dockerfile: input.dockerfile,
      bunVersion: input.bunVersion,
    }),
    findFlyReleaseCommandProblem(input.flyToml),
  ].filter((problem): problem is string => problem !== null);
}

if (import.meta.main) {
  const problems = verifyDeployConfig({
    dockerfile: readFileSync('apps/web/Dockerfile', 'utf8'),
    flyToml: readFileSync('fly.toml', 'utf8'),
    bunVersion: readFileSync('.bun-version', 'utf8').trim(),
  });
  if (problems.length > 0) {
    process.stderr.write(
      `Deploy config drift:\n${problems.map((problem) => `- ${problem}\n`).join('')}`,
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(
      'Deploy config matches .bun-version and keeps the release command.\n',
    );
  }
}
