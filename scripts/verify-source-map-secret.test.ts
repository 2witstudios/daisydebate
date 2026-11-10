import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { readFileSync } from 'node:fs';
import {
  SOURCE_MAP_SECRET_PROBLEM,
  findSourceMapSecretProblem,
} from './verify-source-map-secret';

setupRitewayBun();

const dockerfile = readFileSync('apps/web/Dockerfile', 'utf8');
const workflow = readFileSync('.github/workflows/deploy-staging.yml', 'utf8');

/** Each change applied to one committed file: did it apply, and what is reported. */
const reported = (
  file: 'dockerfile' | 'workflow',
  changes: readonly (readonly [string | RegExp, string])[],
) =>
  changes.map(([from, to]) => {
    const original = file === 'dockerfile' ? dockerfile : workflow;
    const changed = original.replace(from, to);
    return [
      changed !== original,
      findSourceMapSecretProblem(
        file === 'dockerfile'
          ? { dockerfile: changed, workflow }
          : { dockerfile, workflow: changed },
      ),
    ];
  });

describe('findSourceMapSecretProblem (ADR 0037 source maps)', () => {
  test('the committed image build and deploy wiring', () => {
    assert({
      given: 'the committed Dockerfile and deploy-staging.yml',
      should: 'report no problem',
      actual: findSourceMapSecretProblem({ dockerfile, workflow }),
      expected: null,
    });
  });

  test('a token that could reach a layer, the image config or the history', () => {
    assert({
      given:
        'the token as a Dockerfile ARG, as an ENV, and as a deploy --build-arg',
      should: 'report each',
      actual: [
        ...reported('dockerfile', [
          [
            'ARG GIT_COMMIT=unknown\nRUN',
            'ARG SENTRY_AUTH_TOKEN\nARG GIT_COMMIT=unknown\nRUN',
          ],
          [
            'ARG GIT_COMMIT=unknown\nRUN',
            'ENV SENTRY_AUTH_TOKEN=x\nARG GIT_COMMIT=unknown\nRUN',
          ],
        ]),
        ...reported('workflow', [
          [
            '--build-secret SENTRY_AUTH_TOKEN="$SENTRY_AUTH_TOKEN"',
            '--build-arg SENTRY_AUTH_TOKEN="$SENTRY_AUTH_TOKEN"',
          ],
        ]),
      ],
      expected: [
        [true, SOURCE_MAP_SECRET_PROBLEM],
        [true, SOURCE_MAP_SECRET_PROBLEM],
        [true, SOURCE_MAP_SECRET_PROBLEM],
      ],
    });
  });

  test('a Next build that never sees the secret or the release', () => {
    assert({
      given:
        'the build RUN without its secret mount, without reading the secret, and without the GIT_COMMIT release',
      should: 'report each',
      actual: reported('dockerfile', [
        ['--mount=type=secret,id=SENTRY_AUTH_TOKEN,required=false ', ''],
        ['"$(cat /run/secrets/SENTRY_AUTH_TOKEN 2>/dev/null || true)"', '""'],
        ['ARG GIT_COMMIT=unknown\nRUN', 'RUN'],
      ]),
      expected: [
        [true, SOURCE_MAP_SECRET_PROBLEM],
        [true, SOURCE_MAP_SECRET_PROBLEM],
        [true, SOURCE_MAP_SECRET_PROBLEM],
      ],
    });
  });

  test('a web-building deploy step that drops the secret, or a step that holds it without need', () => {
    assert({
      given:
        'the migrator or web deploy without --build-secret, a step without the secret in its env, the secret at job level, and the realtime step holding it',
      should: 'report each',
      actual: reported('workflow', [
        [
          /(-c fly\.migrate\.toml --local-only --update-only)\n\s+--build-secret SENTRY_AUTH_TOKEN="\$SENTRY_AUTH_TOKEN"/,
          '$1',
        ],
        [
          /(-a daisy-debate-staging --local-only --ha=false)\n\s+--build-secret SENTRY_AUTH_TOKEN="\$SENTRY_AUTH_TOKEN"/,
          '$1',
        ],
        [/\n\s+SENTRY_AUTH_TOKEN: \$\{\{ secrets\.SENTRY_AUTH_TOKEN \}\}/, ''],
        [
          '    env:\n      # The commit CI verified',
          '    env:\n      SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}\n      # The commit CI verified',
        ],
        [
          'FLY_API_TOKEN: ${{ secrets.FLY_REALTIME_API_TOKEN }}',
          'FLY_API_TOKEN: ${{ secrets.FLY_REALTIME_API_TOKEN }}\n          SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}',
        ],
      ]),
      expected: [
        [true, SOURCE_MAP_SECRET_PROBLEM],
        [true, SOURCE_MAP_SECRET_PROBLEM],
        [true, SOURCE_MAP_SECRET_PROBLEM],
        [true, SOURCE_MAP_SECRET_PROBLEM],
        [true, SOURCE_MAP_SECRET_PROBLEM],
      ],
    });
  });
});
