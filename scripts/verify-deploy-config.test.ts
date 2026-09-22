import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { readFileSync } from 'node:fs';
import {
  findDockerfileBunVersionProblem,
  findFlyReleaseCommandProblem,
  verifyDeployConfig,
} from './verify-deploy-config';

setupRitewayBun();

const realDockerfile = readFileSync('apps/web/Dockerfile', 'utf8');
const realFlyToml = readFileSync('fly.toml', 'utf8');
const realBunVersion = readFileSync('.bun-version', 'utf8').trim();

describe('findDockerfileBunVersionProblem', () => {
  test('the committed Dockerfile pins the committed .bun-version', () => {
    assert({
      given: 'the real Dockerfile and .bun-version',
      should: 'report no drift',
      actual: findDockerfileBunVersionProblem({
        dockerfile: realDockerfile,
        bunVersion: realBunVersion,
      }),
      expected: null,
    });
  });

  test('a Dockerfile pinned to a different Bun version', () => {
    assert({
      given: 'FROM oven/bun:1.0.0-slim AS base with .bun-version 1.4.2',
      should: 'report the drift',
      actual: findDockerfileBunVersionProblem({
        dockerfile: 'FROM oven/bun:1.0.0-slim AS base\n',
        bunVersion: '1.4.2',
      }),
      expected:
        'Dockerfile pins oven/bun:1.0.0-slim, but .bun-version is 1.4.2',
    });
  });

  test('a Dockerfile missing the base image line entirely', () => {
    assert({
      given: 'a Dockerfile with no base stage',
      should: 'report it missing rather than pass silently',
      actual: findDockerfileBunVersionProblem({
        dockerfile: 'FROM node:22 AS base\n',
        bunVersion: '1.4.2',
      }),
      expected: 'Dockerfile has no `FROM oven/bun:<version> AS base` line',
    });
  });
});

describe('findFlyReleaseCommandProblem', () => {
  test('the committed fly.toml keeps the migration release command', () => {
    assert({
      given: 'the real fly.toml',
      should: 'report no drift',
      actual: findFlyReleaseCommandProblem(realFlyToml),
      expected: null,
    });
  });

  test('fly.toml with the release_command line removed', () => {
    assert({
      given: 'a [deploy] block with no release_command',
      should: 'report it missing',
      actual: findFlyReleaseCommandProblem('[deploy]\n'),
      expected: 'fly.toml has no `release_command` under [deploy]',
    });
  });

  test('fly.toml with an emptied release_command', () => {
    assert({
      given: 'release_command = ""',
      should: 'report it empty',
      actual: findFlyReleaseCommandProblem(
        '[deploy]\n  release_command = ""\n',
      ),
      expected: 'fly.toml release_command is empty',
    });
  });
});

describe('verifyDeployConfig', () => {
  test('the real repository files together', () => {
    assert({
      given: 'the committed Dockerfile, fly.toml and .bun-version',
      should: 'report no problems',
      actual: verifyDeployConfig({
        dockerfile: realDockerfile,
        flyToml: realFlyToml,
        bunVersion: realBunVersion,
      }),
      expected: [],
    });
  });

  test('both files drifted at once', () => {
    assert({
      given: 'a wrong Bun version and a dropped release command',
      should: 'report both problems, not just the first',
      actual: verifyDeployConfig({
        dockerfile: 'FROM oven/bun:1.0.0-slim AS base\n',
        flyToml: '[deploy]\n',
        bunVersion: '1.4.2',
      }).length,
      expected: 2,
    });
  });
});
