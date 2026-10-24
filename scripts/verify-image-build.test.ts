import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { readFileSync } from 'node:fs';
import {
  findDefaultStageProblem,
  findImageTypecheckProblem,
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
