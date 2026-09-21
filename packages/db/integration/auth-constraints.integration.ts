import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';

setupRitewayBun();

const url = process.env.TEST_DATABASE_URL;
if (!url)
  throw new Error(
    'TEST_DATABASE_URL required; never use application database for tests',
  );
if (!new URL(url).pathname.endsWith('_test'))
  throw new Error('Test database name must end in _test');

const rejected = async (attempt: () => Promise<unknown>) => {
  try {
    await attempt();
    return false;
  } catch {
    return true;
  }
};

test('usernames are unique regardless of case', async () => {
  const sql = new SQL(url);
  const ids = [createId(), createId(), createId()];
  const name = `Ada${createId()}`;
  const insert = (id: string, username: string) =>
    sql.unsafe('insert into users (id, username) values ($1, $2)', [
      id,
      username,
    ]);
  try {
    await insert(ids[0]!, name);
    const caseVariantRejected = await rejected(() =>
      insert(ids[1]!, name.toUpperCase()),
    );
    const distinctRejected = await rejected(() =>
      insert(ids[2]!, `${name}-other`),
    );
    assert({
      given: 'an existing username and a second differing only by case',
      should: 'reject the case variant and accept a genuinely distinct name',
      actual: { caseVariantRejected, distinctRejected },
      expected: { caseVariantRejected: true, distinctRejected: false },
    });
  } finally {
    await sql.unsafe('delete from users where id in ($1, $2, $3)', ids);
    await sql.close();
  }
});

test('a user referenced by a debate cannot be deleted', async () => {
  const sql = new SQL(url);
  const userId = createId();
  const debateId = createId();
  const count = async (table: 'users' | 'debates', id: string) =>
    (
      await sql.unsafe(
        `select count(*)::int as c from ${table} where id = $1`,
        [id],
      )
    )[0].c;
  try {
    await sql.unsafe('insert into users (id, username) values ($1, $2)', [
      userId,
      `owner-${userId}`,
    ]);
    await sql.unsafe(
      "insert into debates (id, created_by, resolution, format, snapshot) values ($1, $2, 'r', 'f', '{}')",
      [debateId, userId],
    );
    const blocked = await rejected(() =>
      sql.unsafe('delete from users where id = $1', [userId]),
    );
    const intact = {
      user: await count('users', userId),
      debate: await count('debates', debateId),
    };
    await sql.unsafe('delete from debates where id = $1', [debateId]);
    const freedRejected = await rejected(() =>
      sql.unsafe('delete from users where id = $1', [userId]),
    );
    assert({
      given: 'a user who owns a debate',
      should:
        'reject deletion and keep both rows, then allow it once the debate is gone',
      actual: { blocked, intact, freedRejected },
      expected: {
        blocked: true,
        intact: { user: 1, debate: 1 },
        freedRejected: false,
      },
    });
  } finally {
    await sql.unsafe('delete from debates where id = $1', [debateId]);
    await sql.unsafe('delete from users where id = $1', [userId]);
    await sql.close();
  }
});
