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

  test('a remote build hidden past the line that starts the deploy (ISSUE-544)', () => {
    assert({
      given:
        '--remote-only on a folded continuation line, --depot after a backslash, --local-only=false, the fly alias with no location, and --local-only only in a trailing shell comment',
      should: 'report each, reading the whole command the shell runs',
      actual: [
        findRunnerBuildProblem(
          workflow.replace(
            'flyctl deploy -c fly.realtime.toml --local-only --ha=false\n',
            'flyctl deploy -c fly.realtime.toml --local-only --ha=false\n          --remote-only\n',
          ),
        ),
        findRunnerBuildProblem(
          workflow.replace(
            '--env LIVEKIT_SOURCE_COMMIT="$DEPLOY_SHA"',
            '--env LIVEKIT_SOURCE_COMMIT="$DEPLOY_SHA" --depot',
          ),
        ),
        findRunnerBuildProblem(
          workflow.replace(
            'flyctl deploy -a daisy-debate-staging --local-only',
            'flyctl deploy -a daisy-debate-staging --local-only=false',
          ),
        ),
        findRunnerBuildProblem(
          workflow.replace(
            'flyctl deploy -a daisy-debate-staging --local-only',
            'fly deploy -a daisy-debate-staging',
          ),
        ),
        findRunnerBuildProblem(
          workflow.replace(
            'flyctl deploy -c fly.media-worker.toml --local-only --ha=false',
            'flyctl deploy -c fly.media-worker.toml --ha=false # --local-only',
          ),
        ),
      ],
      expected: [problem, problem, problem, problem, problem],
    });
  });

  test('a remote build the shell would run past the reader (ISSUE-546)', () => {
    const web =
      'run: >-\n          flyctl deploy -a daisy-debate-staging --local-only';
    const realtime =
      'flyctl deploy -c fly.realtime.toml --local-only --ha=false';
    assert({
      given:
        'a commented and an indented block header, a chained and a blank-line-separated second deploy, a # inside quotes, and a quoted flag',
      should: 'report each, reading the commands as the shell would',
      actual: [
        workflow.replace(
          web,
          'run: >- # note\n          flyctl deploy -a daisy-debate-staging --remote-only',
        ),
        workflow.replace(
          web,
          'run: |2\n          flyctl deploy -a daisy-debate-staging --remote-only',
        ),
        workflow.replace(
          realtime,
          `${realtime} && flyctl deploy -c fly.realtime.toml --ha=false`,
        ),
        workflow.replace(
          `${realtime}\n`,
          `${realtime}\n\n          flyctl deploy -c fly.realtime.toml --ha=false\n`,
        ),
        workflow.replace(
          '--env LIVEKIT_SOURCE_COMMIT="$DEPLOY_SHA"',
          '--env NOTE="a #b" --remote-only --env LIVEKIT_SOURCE_COMMIT="$DEPLOY_SHA"',
        ),
        workflow.replace(
          'flyctl deploy -c fly.livekit.toml --local-only',
          'flyctl deploy -c fly.livekit.toml --local-only "--remote-only"',
        ),
      ].map((changed) => [
        changed !== workflow,
        findRunnerBuildProblem(changed),
      ]),
      expected: Array.from({ length: 6 }, () => [true, problem]),
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
