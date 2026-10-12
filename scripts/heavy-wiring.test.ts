import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { HEAVY_ENV, lockDir, unqueued } from './heavy';

setupRitewayBun();

describe('unqueued', () => {
  test('strips the queue prefix and any leading env assignment', () => {
    assert({
      given: 'a root, a web, an env-prefixed web, and an unqueued script',
      should: 'return each command without the queue',
      actual: [
        unqueued("bun scripts/heavy.ts sh -c 'bun test scripts'"),
        unqueued('bun ../../scripts/heavy.ts bun test src scripts'),
        unqueued(
          'NODE_ENV=production bun ../../scripts/heavy.ts bun --bun next build',
        ),
        unqueued('bun test src'),
      ],
      expected: [
        "sh -c 'bun test scripts'",
        'bun test src scripts',
        'bun --bun next build',
        'bun test src',
      ],
    });
  });
});

describe('one machine-wide pool', () => {
  test('uses one fixed lock directory whatever TMPDIR says', () => {
    assert({
      given: 'two TMPDIRs, and an explicit DAISY_HEAVY_LOCK_DIR',
      should:
        'use /tmp/daisy-heavy-slots for both, and the explicit one when set',
      actual: [
        lockDir({ TMPDIR: '/var/folders/xy/T/' }),
        lockDir({ TMPDIR: '/tmp' }),
        lockDir({ DAISY_HEAVY_LOCK_DIR: '/srv/heavy', TMPDIR: '/tmp' }),
      ],
      expected: [
        '/tmp/daisy-heavy-slots',
        '/tmp/daisy-heavy-slots',
        '/srv/heavy',
      ],
    });
  });

  test('passes the limit settings through turbo to every task', async () => {
    const turbo = (await Bun.file(
      new URL('../turbo.json', import.meta.url),
    ).json()) as { globalPassThroughEnv?: string[] };
    assert({
      given: "turbo's strict env mode",
      should: 'pass every DAISY_HEAVY_* setting through globally',
      actual: HEAVY_ENV.every((name) =>
        turbo.globalPassThroughEnv?.includes(name),
      ),
      expected: true,
    });
  });

  test('queues every heavy root and web script', async () => {
    const scripts = async (path: string) =>
      (
        (await Bun.file(new URL(path, import.meta.url)).json()) as {
          scripts: Record<string, string>;
        }
      ).scripts;
    const root = await scripts('../package.json');
    const web = await scripts('../apps/web/package.json');
    const queued = (command: string | undefined) =>
      command !== undefined && unqueued(command) !== command;
    assert({
      given: 'the root and apps/web package scripts',
      should: 'start each heavy one through the queue',
      actual: {
        root: [
          'build',
          'typecheck',
          'lint',
          'test',
          'test:integration',
          'test:e2e',
          'check',
          'check:affected',
          'verify',
          'dev',
          'dev:agent',
          'knip',
          'duplication',
        ].filter((name) => !queued(root[name])),
        web: ['dev', 'build', 'typecheck', 'test', 'test:e2e'].filter(
          (name) => !queued(web[name]),
        ),
      },
      expected: { root: [], web: [] },
    });
  });
});
