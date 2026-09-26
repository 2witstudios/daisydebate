/**
 * The agent guard's deploy rule (ADR 0035 amendment, 2026-09-25, refined
 * after the PR #113 review): deploy-rail changes need a human-only sign-off
 * leaf (AGENTS.md), so an autonomous agent may run only the read-only fly
 * and flyctl diagnostics this file allowlists; every mutating subcommand,
 * and anything this file does not recognize, is refused.
 */
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { decide, owner } from './agent-guard.test-support';

setupRitewayBun();

describe('agent guard: deploy-rail tools', () => {
  test('refuses mutating fly and flyctl subcommands for an autonomous agent', () => {
    assert({
      given: 'a deploy, a secrets write, an app destroy and a machine stop',
      should: 'deny each one',
      actual: [
        decide('fly deploy -a daisy-debate-staging --ha=false'),
        decide('flyctl secrets set -a daisy-debate-staging FOO=bar'),
        decide('fly apps destroy daisy-debate-staging --yes'),
        decide('fly machines stop -a daisy-debate-staging abc123'),
        decide('fly ssh console -a daisy-debate-staging'),
      ],
      expected: Array(5).fill('deny'),
    });
  });

  test('allows the read-only diagnostics scripts/staging-security-probe.ts (AUTH-7.8) depends on', () => {
    assert({
      given:
        'fly logs, status, apps list, machines list, secrets list and auth whoami',
      should: 'allow each one',
      actual: [
        decide('fly logs -a daisy-debate-staging --no-tail'),
        decide('fly status -a daisy-debate-staging'),
        decide('flyctl apps list'),
        decide('fly machines list -a daisy-debate-staging'),
        decide('fly secrets list -a daisy-debate-staging'),
        decide('fly auth whoami'),
        decide('/usr/local/bin/flyctl status -a daisy-debate-staging'),
      ],
      expected: Array(7).fill('allow'),
    });
  });

  test('leaves owner sessions free to deploy', () => {
    assert({
      given: 'an owner session deploying with fly',
      should: 'allow it',
      actual: decide('fly deploy -a daisy-debate-staging', owner()),
      expected: 'allow',
    });
  });
});
