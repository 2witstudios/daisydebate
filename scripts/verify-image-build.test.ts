import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { readFileSync } from 'node:fs';
import {
  findDefaultStageProblem,
  findImageTypecheckProblem,
  findRunnerBuildProblem,
} from './verify-image-build';

setupRitewayBun();

const realDockerfile = readFileSync('apps/web/Dockerfile', 'utf8');

describe('findImageTypecheckProblem (ISSUE-527)', () => {
  const nextConfig = readFileSync('apps/web/next.config.ts', 'utf8');

  test('the committed image skips only its duplicate typecheck', () => {
    assert({
      given: 'the committed Dockerfile and next.config.ts',
      should: 'report no problem',
      actual: findImageTypecheckProblem({
        dockerfile: realDockerfile,
        nextConfig,
      }),
      expected: null,
    });
  });

  test('a config that skips type errors everywhere, or an image that never says it is one', () => {
    const problem =
      "next.config.ts must skip type errors only for the image build (ignoreBuildErrors: process.env.DAISY_IMAGE_BUILD === '1'), and only the Dockerfile build stage may set DAISY_IMAGE_BUILD=1; CI typechecks every deployed commit";
    assert({
      given:
        'ignoreBuildErrors hard-coded true, the guard missing, and a Dockerfile that never sets DAISY_IMAGE_BUILD',
      should: 'report each',
      actual: [
        findImageTypecheckProblem({
          dockerfile: realDockerfile,
          nextConfig: nextConfig.replace(
            "process.env.DAISY_IMAGE_BUILD === '1'",
            'true',
          ),
        }),
        findImageTypecheckProblem({
          dockerfile: realDockerfile,
          nextConfig: 'export default {};',
        }),
        findImageTypecheckProblem({
          dockerfile: realDockerfile.replaceAll('DAISY_IMAGE_BUILD=1 ', ''),
          nextConfig,
        }),
      ],
      expected: [problem, problem, problem],
    });
  });
});

describe('findDefaultStageProblem (ISSUE-528)', () => {
  test('the web image stays the default target', () => {
    assert({
      given:
        'the committed Dockerfile, then one with a service stage moved last',
      should:
        'pass the committed file and report the move, since fly.toml and fly.migrate.toml build the default target',
      actual: [
        findDefaultStageProblem(realDockerfile),
        findDefaultStageProblem(
          `${realDockerfile}\nFROM server-source AS realtime-late\n`,
        ),
      ],
      expected: [
        null,
        'apps/web/Dockerfile must end with the `runtime` stage: fly.toml and fly.migrate.toml build the default (last) target',
      ],
    });
  });
});

describe('findRunnerBuildProblem (ISSUE-542)', () => {
  const workflow = readFileSync('.github/workflows/deploy-staging.yml', 'utf8');
  const problem =
    "deploy-staging.yml must build every image on the runner (`flyctl deploy ... --local-only`): Fly's 4-CPU Depot builder stalls next build's page-data workers";

  test('the committed workflow builds every image on the runner', () => {
    assert({
      given: 'the committed deploy-staging.yml',
      should: 'report no problem',
      actual: findRunnerBuildProblem(workflow),
      expected: null,
    });
  });

  test('a deploy that builds remotely, or never says where it builds', () => {
    assert({
      given:
        'one deploy switched to --remote-only, then one with no build location',
      should: 'report each, since flyctl defaults to the remote builder',
      actual: [
        findRunnerBuildProblem(
          workflow.replace(
            'flyctl deploy -c fly.realtime.toml --local-only',
            'flyctl deploy -c fly.realtime.toml --remote-only',
          ),
        ),
        findRunnerBuildProblem(
          workflow.replace(
            'flyctl deploy -a daisy-debate-staging --local-only',
            'flyctl deploy -a daisy-debate-staging',
          ),
        ),
      ],
      expected: [problem, problem],
    });
  });

  test('a workflow with no deploy at all', () => {
    assert({
      given: 'a workflow that never runs flyctl deploy',
      should: 'report it rather than pass vacuously',
      actual: findRunnerBuildProblem('jobs: {}\n'),
      expected: problem,
    });
  });
});
