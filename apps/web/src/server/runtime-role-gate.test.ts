import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { refuseSchemaAlteringRole } from './runtime-role-gate';

setupRitewayBun();

const outcome = async (NODE_ENV: string, problems: readonly string[]) => {
  let queried = false;
  try {
    await refuseSchemaAlteringRole({
      config: { NODE_ENV },
      database: {
        runtimeRoleProblems: async () => {
          queried = true;
          return problems;
        },
      },
    });
    return { queried, refused: null };
  } catch (error) {
    return { queried, refused: (error as Error).message };
  }
};

describe('refuseSchemaAlteringRole', () => {
  test('refuses a production role that can alter the schema', async () => {
    assert({
      given: 'production config and a role that owns schema public',
      should: 'refuse to start, naming the capabilities and the fix',
      actual: await outcome('production', [
        'can create in schema public',
        'owns schema public',
      ]),
      expected: {
        queried: true,
        refused:
          'Production refuses a DATABASE_URL role that can create in schema public, owns schema public; use the DML-only daisy_web role',
      },
    });
  });

  test('starts in production as a DML-only role', async () => {
    assert({
      given: 'production config and a role with no schema capability',
      should: 'start',
      actual: await outcome('production', []),
      expected: { queried: true, refused: null },
    });
  });

  test('never checks outside production', async () => {
    assert({
      given: 'development config running as the local owner',
      should: 'start without querying the role',
      actual: await outcome('development', ['owns schema public']),
      expected: { queried: false, refused: null },
    });
  });
});
