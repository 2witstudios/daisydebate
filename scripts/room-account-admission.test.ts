import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { validateRoomCleanupTarget } from './room-account-admission';
import { slotEnvValues, worktreeSlot } from './slot-model';
import { resolveCheckout } from './slot';
setupRitewayBun();

async function runAdmissionProcess(
  body: string | Uint8Array,
  cwd: string,
  args: readonly string[] = [],
  env = process.env,
) {
  const child = Bun.spawn(
    [
      'bun',
      new URL('./room-account-admission.ts', import.meta.url).pathname,
      ...args,
    ],
    { cwd, env, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
  );
  child.stdin.write(body);
  child.stdin.end();
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exit };
}

describe('ROOM-6.1 cleanup target admission', () => {
  const slot = worktreeSlot('unit_room');
  const base = {
    DATABASE_URL: 'postgres://owner:unit@localhost:15432/daisy',
    REDIS_URL: 'redis://localhost:6379/0',
  };
  const env = { ...base, ...slotEnvValues({ slot, env: base, portBlock: 3 }) };

  test('accepts only the derived checkout E2E role and database', () => {
    assert({
      given: 'slot:up values for this checkout',
      should: 'admit the exact E2E target',
      actual: validateRoomCleanupTarget(slot, env).database,
      expected: slot.e2eDatabase,
    });
  });

  for (const [label, target] of [
    ['integration database', env.TEST_DATABASE_URL],
    ['another slot', env.E2E_DATABASE_URL.replace('unit_room', 'other_room')],
    [
      'remote host',
      env.E2E_DATABASE_URL.replace('localhost', 'remote.example'),
    ],
    ['another server', env.E2E_DATABASE_URL.replace('15432', '25432')],
    ['privileged role', env.E2E_DATABASE_URL.replace('daisy_e2e', 'owner')],
  ] as const) {
    test(`refuses ${label} before a connection can be opened`, () => {
      let refused = false;
      try {
        validateRoomCleanupTarget(slot, { ...env, E2E_DATABASE_URL: target });
      } catch (error) {
        refused =
          error instanceof Error &&
          error.message === 'Room account cleanup target refused';
      }
      assert({
        given: label,
        should: 'refuse with a scrubbed error before database admission',
        actual: refused,
        expected: true,
      });
    });
  }
});

describe('ROOM-6.1 read-only admission executable', () => {
  const root = new URL('../', import.meta.url).pathname;
  const valid = JSON.stringify({
    version: 1,
    operation: 'admit-room-account-cleanup',
  });

  for (const [label, body, args, cwd] of [
    [
      'unknown input',
      JSON.stringify({ version: 1, operation: 'reset' }),
      [],
      root,
    ],
    [
      'caller checkout',
      JSON.stringify({
        version: 1,
        operation: 'admit-room-account-cleanup',
        checkout: root,
      }),
      [],
      root,
    ],
    ['UTF-8 byte overflow', 'é'.repeat(65), [], root],
    ['invalid UTF-8', new Uint8Array([0xff]), [], root],
    ['command argument', valid, ['--checkout', root], root],
    ['wrong cwd', valid, [], '/tmp'],
  ] as const) {
    test(`denies ${label} with no target or raw diagnostics`, async () => {
      const { stdout, stderr, exit } = await runAdmissionProcess(
        body,
        cwd,
        args,
      );
      assert({
        given: label,
        should: 'exit denied without admitting a database',
        actual: { stdout, exit, result: JSON.parse(stderr) },
        expected: {
          stdout: '',
          exit: 1,
          result: {
            version: 1,
            admitted: false,
            reason: label === 'wrong cwd' ? 'checkout' : 'input',
          },
        },
      });
    });
  }

  test('uses effective default PostgreSQL port metadata without credentials', () => {
    const slot = worktreeSlot('default_port');
    const base = {
      DATABASE_URL: 'postgres://owner:private@localhost/daisy',
      REDIS_URL: 'redis://localhost:6379/0',
    };
    const env = {
      ...base,
      ...slotEnvValues({ slot, env: base, portBlock: 3 }),
    };
    assert({
      given: 'a PostgreSQL URL with no explicit port',
      should: 'return decimal string 5432 and nonsecret metadata only',
      actual: validateRoomCleanupTarget(slot, env),
      expected: {
        database: slot.e2eDatabase,
        role: 'daisy_e2e',
        hostname: 'localhost',
        port: '5432',
      },
    });
  });
});

test('actual admission process returns only this executable checkout metadata', async () => {
  const checkout = await resolveCheckout(import.meta.dir);
  const base = {
    DATABASE_URL: 'postgres://owner:unit-private@localhost/daisy',
    REDIS_URL: 'redis://localhost:6379/0',
  };
  const values = slotEnvValues({
    slot: checkout.slot,
    env: base,
    portBlock: 3,
  });
  const { stdout, stderr, exit } = await runAdmissionProcess(
    JSON.stringify({ version: 1, operation: 'admit-room-account-cleanup' }),
    checkout.path,
    [],
    { ...process.env, ...base, ...values },
  );
  assert({
    given: 'own canonical executable root and validated synthetic slot env',
    should:
      'admit read-only without opening SQL or returning credential material',
    actual: { exit, stderr, result: JSON.parse(stdout) },
    expected: {
      exit: 0,
      stderr: '',
      result: {
        version: 1,
        admitted: true,
        target: {
          database: checkout.slot.e2eDatabase,
          role: 'daisy_e2e',
          hostname: 'localhost',
          port: '5432',
        },
      },
    },
  });
});
