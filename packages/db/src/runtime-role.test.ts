import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { runtimeRoleFactsFrom, runtimeRoleProblems } from './runtime-role';

setupRitewayBun();

const dmlOnly = {
  superuser: false,
  create_in_public: false,
  owns_public_schema: false,
  owned_objects_in_public: 0,
};

describe('runtimeRoleProblems', () => {
  test('accepts a DML-only role', () => {
    assert({
      given: 'a role with no superuser, create, schema or object ownership',
      should: 'report nothing',
      actual: runtimeRoleProblems(runtimeRoleFactsFrom(dmlOnly)),
      expected: [],
    });
  });

  test('names each way a role could create or alter schema objects', () => {
    assert({
      given:
        'a superuser, a role with CREATE on public, the schema owner and an object owner',
      should: 'report each capability without naming the role',
      actual: [
        { ...dmlOnly, superuser: true },
        { ...dmlOnly, create_in_public: true },
        { ...dmlOnly, owns_public_schema: true },
        { ...dmlOnly, owned_objects_in_public: 3 },
      ].map((row) => runtimeRoleProblems(runtimeRoleFactsFrom(row))),
      expected: [
        ['is a superuser'],
        ['can create in schema public'],
        ['owns schema public'],
        ['owns 3 objects in schema public'],
      ],
    });
  });
});
