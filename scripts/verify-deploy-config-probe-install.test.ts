import { readFileSync } from 'node:fs';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { findProbeInstallProblem } from './verify-deploy-config';

setupRitewayBun();

const realProbeWorkflow = readFileSync(
  '.github/workflows/auth-alerts.yml',
  'utf8',
);

const SETUP = `      - uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0
        with:
          bun-version-file: .bun-version
`;
const INSTALL = `      - name: Install dependencies
        run: bun install --frozen-lockfile
`;
const PROBE = `      - name: Probe
        run: >-
          bun --no-install scripts/auth-alert-probe.ts
          --origin https://example.test
`;
const job = (...steps: string[]) =>
  `jobs:\n  probe:\n    steps:\n${steps.join('')}`;

describe('findProbeInstallProblem (ISSUE-219)', () => {
  test('the committed auth-alerts workflow installs from bun.lock before the probe and forbids auto-install', () => {
    assert({
      given: 'the real .github/workflows/auth-alerts.yml',
      should: 'report no problem',
      actual: findProbeInstallProblem(realProbeWorkflow),
      expected: null,
    });
  });

  test('a job that could run the probe on registry auto-install', () => {
    assert({
      given:
        'the three steps in order; then no install, the install after the probe, an unfrozen install, a probe without --no-install, a Bun set up without .bun-version, and a commented-out install',
      should: 'accept only the first and report each other one',
      actual: [
        job(SETUP, INSTALL, PROBE),
        job(SETUP, PROBE),
        job(SETUP, PROBE, INSTALL),
        job(SETUP, INSTALL.replace(' --frozen-lockfile', ''), PROBE),
        job(SETUP, INSTALL, PROBE.replace('bun --no-install ', 'bun ')),
        job(
          SETUP.replace(
            'bun-version-file: .bun-version',
            "bun-version: '1.4.2'",
          ),
          INSTALL,
          PROBE,
        ),
        job(SETUP, `      # - run: bun install --frozen-lockfile\n`, PROBE),
      ].map((workflow) => findProbeInstallProblem(workflow) === null),
      expected: [true, false, false, false, false, false, false],
    });
  });
});
