/**
 * The agent guard's deploy rule (ADR 0035 amendment, 2026-09-25): deploy-rail
 * changes need a human-only sign-off leaf (AGENTS.md), so fly and flyctl are
 * refused for an autonomous agent whatever the subcommand.
 */
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { decide, owner } from './agent-guard.test-support';

setupRitewayBun();

describe('agent guard: deploy-rail tools', () => {
  test('refuses every fly and flyctl invocation for an autonomous agent', () => {
    assert({
      given: 'a staging deploy, a secrets read and an apps list',
      should: 'deny each one',
      actual: [
        decide('fly deploy -a daisy-debate-staging --ha=false'),
        decide('flyctl secrets list -a daisy-debate-staging'),
        decide('fly apps list'),
        decide('/usr/local/bin/flyctl status -a daisy-debate-staging'),
      ],
      expected: Array(4).fill('deny'),
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
