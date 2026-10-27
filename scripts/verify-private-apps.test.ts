import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  findServiceAppConfigProblems,
  findServiceDeployProblems,
  SERVICE_APPS,
} from './verify-service-apps';

setupRitewayBun();

/** ADR 0076: the admin app is 6PN-only, so nothing may give it a public face. */
describe('the private admin app (ADR 0076)', () => {
  test('its config never declares a public service', () => {
    const repo = (adminToml: string) => (path: string) =>
      path === 'fly.admin.toml'
        ? adminToml
        : // Every other config is irrelevant here; report only admin problems.
          undefined;
    const admin = (extra: string) =>
      `app = "daisy-debate-staging-admin"\n\n[build]\n  dockerfile = "apps/web/Dockerfile"\n  build-target = "admin"\n${extra}`;
    const adminProblems = (toml: string) =>
      findServiceAppConfigProblems(repo(toml)).filter(
        (problem) =>
          problem.startsWith('fly.admin.toml') && problem.includes('private'),
      );
    assert({
      given: 'the admin config bare, with [http_service] and with [[services]]',
      should: 'report each public service',
      actual: [
        adminProblems(admin('')),
        adminProblems(admin('\n[http_service]\n  internal_port = 8080\n')),
        adminProblems(admin('\n[[services]]\n  internal_port = 8080\n')),
      ],
      expected: [
        [],
        [
          'fly.admin.toml is private (6PN only) and must declare no [http_service] or [[services]]',
        ],
        [
          'fly.admin.toml is private (6PN only) and must declare no [http_service] or [[services]]',
        ],
      ],
    });
  });

  test('its deploy never allocates a public address', () => {
    const step = (config: string, token: string, flags = '') =>
      `      - id: x\n        env:\n          FLY_API_TOKEN: \${{ secrets.${token} }}\n        run: >-\n          flyctl deploy -c ${config} --local-only${flags}\n`;
    const migrate =
      '      - id: migrate\n        run: >-\n          flyctl deploy -c fly.migrate.toml --local-only --update-only\n';
    const others = SERVICE_APPS.filter(({ file }) => file !== 'fly.admin.toml')
      .map((app) => step(app.file, app.token))
      .join('');
    const workflow = (flags: string) =>
      migrate + others + step('fly.admin.toml', 'FLY_ADMIN_API_TOKEN', flags);
    assert({
      given: 'the admin deploy with and without --no-public-ips',
      should: 'report only the deploy that could allocate a public address',
      actual: [
        findServiceDeployProblems(workflow(' --no-public-ips')),
        findServiceDeployProblems(workflow('')),
      ],
      expected: [
        [],
        [
          'deploy-staging.yml must deploy fly.admin.toml with --no-public-ips (6PN only)',
        ],
      ],
    });
  });
});
