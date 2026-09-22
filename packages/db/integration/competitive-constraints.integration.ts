import { createId } from '@paralleldrive/cuid2';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { at, rejected, withFixture } from './constraint-helpers';

setupRitewayBun();

const url = process.env.TEST_DATABASE_URL;
if (!url)
  throw new Error(
    'TEST_DATABASE_URL required; never use application database for tests',
  );
if (!new URL(url).pathname.endsWith('_test'))
  throw new Error('Test database name must end in _test');

describe('users tombstone (DATA-1.2)', () => {
  test('a tombstone must be scrubbed of PII', async () => {
    await withFixture(url, async (fixture) => {
      const scrubbed = {
        username: null,
        email: null,
        image: null,
        name: '',
        deleted_at: at,
      };
      const withEmail = await fixture.rejects('users', {
        id: createId(),
        ...scrubbed,
        email: `${createId()}@example.com`,
      });
      const withName = await fixture.rejects('users', {
        id: createId(),
        ...scrubbed,
        name: 'Ada',
      });
      const scrubbedAccepted = !(await fixture.rejects('users', {
        id: createId(),
        ...scrubbed,
      }));
      const live = await fixture.user();
      const updateWithEmail = await rejected(() =>
        fixture.sql.unsafe(
          'update users set deleted_at = $2, email = $3 where id = $1',
          [live, at, `${live}@example.com`],
        ),
      );
      const updateScrubbed = !(await rejected(() =>
        fixture.sql.unsafe(
          "update users set deleted_at = $2, email = null, username = null, image = null, name = '' where id = $1",
          [live, at],
        ),
      ));
      assert({
        given: 'inserts and updates that set deleted_at',
        should:
          'reject any tombstone still holding PII and accept a scrubbed one',
        actual: {
          withEmail,
          withName,
          scrubbedAccepted,
          updateWithEmail,
          updateScrubbed,
        },
        expected: {
          withEmail: true,
          withName: true,
          scrubbedAccepted: true,
          updateWithEmail: true,
          updateScrubbed: true,
        },
      });
    });
  });
});

describe('actors (DATA-1.2)', () => {
  test('one human actor per user, and the user outlives deletion attempts', async () => {
    await withFixture(url, async (fixture) => {
      const userId = await fixture.user();
      const actorId = await fixture.actor(userId);
      const secondActor = await fixture.rejects('actors', {
        id: createId(),
        kind: 'human',
        user_id: userId,
      });
      const humanWithoutUser = await fixture.rejects('actors', {
        id: createId(),
        kind: 'human',
        user_id: null,
      });
      const unknownKind = await fixture.rejects('actors', {
        id: createId(),
        kind: 'agent',
        user_id: await fixture.user(),
      });
      const userDeleteBlocked = await rejected(() =>
        fixture.sql.unsafe('delete from users where id = $1', [userId]),
      );
      const intact = {
        user: await fixture.count('users', 'id', userId),
        actor: await fixture.count('actors', 'id', actorId),
      };
      assert({
        given: 'a user with one human actor',
        should:
          'reject a second actor, a human without a user, an unknown kind and deleting the user',
        actual: {
          secondActor,
          humanWithoutUser,
          unknownKind,
          userDeleteBlocked,
          intact,
        },
        expected: {
          secondActor: true,
          humanWithoutUser: true,
          unknownKind: true,
          userDeleteBlocked: true,
          intact: { user: 1, actor: 1 },
        },
      });
    });
  });
});

describe('formats and the debate format key (DATA-1.3)', () => {
  test('debates reference a known format that cannot be removed underneath them', async () => {
    await withFixture(url, async (fixture) => {
      const unknownFormat = await rejected(() =>
        fixture.debate({ format: `fmt-${createId()}` }),
      );
      const formatId = await fixture.format();
      const known = !(await rejected(() =>
        fixture.debate({ format: formatId }),
      ));
      const formatDeleteBlocked = await rejected(() =>
        fixture.sql.unsafe('delete from formats where id = $1', [formatId]),
      );
      const shapelessRules = await fixture.rejectedBy('formats', {
        id: `fmt-${createId()}`,
        name: 'Shapeless',
        rules: {},
        ranked_eligible: false,
      });
      assert({
        given:
          'a debate whose format is unknown, one whose format exists, and a format with empty rules',
        should:
          'reject the unknown format, accept and protect the known one, and refuse rules without the version-1 shape',
        actual: { unknownFormat, known, formatDeleteBlocked, shapelessRules },
        expected: {
          unknownFormat: true,
          known: true,
          formatDeleteBlocked: true,
          shapelessRules: 'formats_rules_shape',
        },
      });
    });
  });
});

describe('role grants (DATA-3.3)', () => {
  test('one active grant per scope, re-grantable after revocation', async () => {
    await withFixture(url, async (fixture) => {
      const userId = await fixture.user();
      const granter = await fixture.user();
      const grant = (overrides: Record<string, unknown>) => ({
        id: createId(),
        user_id: userId,
        role: 'moderator',
        scope_type: 'global',
        scope_id: null,
        granted_by_user_id: granter,
        granted_at: at,
        revoked_at: null,
        ...overrides,
      });
      const first = grant({});
      const granted = !(await fixture.rejects('role_grants', first));
      const duplicateActive = await fixture.rejects('role_grants', grant({}));
      await fixture.sql.unsafe(
        'update role_grants set revoked_at = $2 where id = $1',
        [first.id, at],
      );
      const regranted = !(await fixture.rejects('role_grants', grant({})));
      const globalWithScope = await fixture.rejects(
        'role_grants',
        grant({ role: 'judge', scope_id: createId() }),
      );
      const badRole = await fixture.rejects(
        'role_grants',
        grant({ role: 'owner' }),
      );
      const badScopeType = await fixture.rejects(
        'role_grants',
        grant({
          role: 'judge',
          scope_type: 'tournament',
          scope_id: createId(),
        }),
      );
      const granterDeleteBlocked = await rejected(() =>
        fixture.sql.unsafe('delete from users where id = $1', [granter]),
      );
      assert({
        given: 'a moderator grant that is duplicated, revoked and re-granted',
        should:
          'reject the duplicate while active, accept the re-grant, reject a scoped global grant and unknown vocabularies, and protect the granting user',
        actual: {
          granted,
          duplicateActive,
          regranted,
          globalWithScope,
          badRole,
          badScopeType,
          granterDeleteBlocked,
        },
        expected: {
          granted: true,
          duplicateActive: true,
          regranted: true,
          globalWithScope: true,
          badRole: true,
          badScopeType: true,
          granterDeleteBlocked: true,
        },
      });
    });
  });
});
