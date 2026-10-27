import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { sql } from 'drizzle-orm';
import {
  lockAuthorizationActors,
  loadAuthorizationAccount,
  loadAuthorizationSession,
} from '../src/authorization';
import { authorizationSessionOperations } from '../src/authorization-session';
import { withFixture, sqlStateOf } from './constraint-helpers';
import {
  createAuthorizationSubject,
  subjectFact,
} from './authorization.test-support';
setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);
test('account authorization locks fence erasure and return fresh durable membership', async () => {
  await withFixture(url, async (fixture) => {
    const { userId, actorId } = await createAuthorizationSubject(fixture);
    const sessionId = createId();
    fixture.track('session', sessionId);
    await fixture.sql`insert into session(id,user_id,token,expires_at) values(${sessionId},${userId},${createId()},'2026-10-09T00:01:00Z')`;
    const db = drizzle({ client: fixture.sql });
    const sessionInput = {
      sessionId,
      userId,
      actorId,
      now: '2026-10-09T00:00:00.000Z',
    };
    const sessionReader = authorizationSessionOperations({ database: db });
    assert({
      given: 'the public pool-bound reader',
      should: 'return only current checked session/account facts',
      actual: (await sessionReader.readAuthorizationSession(sessionInput))
        ?.account.revision,
      expected: 1,
    });
    assert({
      given: 'a consumed RT ticket containing sessionId/actorId without userId',
      should: 'resolve the durable user binding under the same account fence',
      actual: (
        await sessionReader.resolveRealtimeSession({
          sessionId,
          actorId,
          now: sessionInput.now,
        })
      )?.userId,
      expected: userId,
    });
    await db.transaction(async (tx) => {
      const facts = await lockAuthorizationActors(tx, [actorId], {
        maxActors: 2,
      });
      assert({
        given: 'live verified member loaded under the command transaction',
        should: 'bind actor and current account revision',
        actual: facts,
        expected: [subjectFact({ userId, actorId })],
      });
      assert({
        given: 'a live session under the same current account fence',
        should:
          'bind its exact actor/user and refuse another binding or expiry',
        actual: [
          (await loadAuthorizationSession(tx, sessionInput))?.account.revision,
          await loadAuthorizationSession(tx, {
            ...sessionInput,
            actorId: createId(),
          }),
          await loadAuthorizationSession(tx, {
            ...sessionInput,
            userId: createId(),
          }),
          await loadAuthorizationSession(tx, {
            ...sessionInput,
            now: '2026-10-09T00:01:00.000Z',
          }),
        ],
        expected: [1, null, null, null],
      });
      const state = await sqlStateOf(() =>
        fixture.sql.begin(
          async (other) =>
            other`select id from users where id=${userId} for update nowait`,
        ),
      );
      assert({
        given: 'a concurrent tombstone/correction writer',
        should: 'be excluded by the account fence',
        actual: state,
        expected: '55P03',
      });
    });
    await db.execute(
      sql`update users set username=null,email=null,image=null,name='',deleted_at='2026-10-09T00:00:00Z',version=version+1 where id=${userId}`,
    );
    assert({
      given: 'the same persisted session after account erasure',
      should: 'refuse authority even while its expiry is in the future',
      actual: await loadAuthorizationSession(db, sessionInput),
      expected: null,
    });
    await fixture.sql`delete from session where id=${sessionId}`;
    assert({
      given: 'a revoked durable session',
      should: 'refuse the ticket identity',
      actual: await loadAuthorizationSession(db, sessionInput),
      expected: null,
    });
    assert({
      given: 'the erasure committed after fence release',
      should: 'refuse membership from freshly reloaded facts',
      actual: await loadAuthorizationAccount(db, userId),
      expected: subjectFact(
        { userId, actorId },
        { member: false, erased: true, revision: 2, ageBand: null },
      ),
    });
  });
});

test("a live session carries its account's beta and age facts (ADR 0075)", async () => {
  await withFixture(url, async (fixture) => {
    const { userId, actorId } = await createAuthorizationSubject(
      fixture,
      'pending',
    );
    const sessionId = createId();
    fixture.track('session', sessionId);
    await fixture.sql`insert into session(id,user_id,token,expires_at) values(${sessionId},${userId},${createId()},'2026-10-09T00:01:00Z')`;
    const db = drizzle({ client: fixture.sql });
    const input = {
      sessionId,
      userId,
      actorId,
      now: '2026-10-09T00:00:00.000Z',
    };
    const pending = await loadAuthorizationSession(db, input);
    await fixture.sql`update account_beta_access set state = 'approved', decided_at = now(), revision = 2 where user_id = ${userId}`;
    const approved = await loadAuthorizationSession(db, input);
    assert({
      given:
        'a live session of a pending account, then the same account approved',
      should:
        'bind the session with the fresh beta and age facts realtime decides participant access on',
      actual: [
        pending?.account.beta,
        pending?.account.ageBand,
        approved?.account.beta,
      ],
      expected: [
        { state: 'pending', revision: 1 },
        'adult',
        { state: 'approved', revision: 2 },
      ],
    });
  });
});

test('the account fact carries its age band from the durable age record, never birth data (ADR 0075)', async () => {
  await withFixture(url, async (fixture) => {
    const adult = await createAuthorizationSubject(fixture);
    const seventeen = await createAuthorizationSubject(fixture);
    const missing = await createAuthorizationSubject(fixture);
    // Born 17 years and one month before now: the 16-17 band.
    await fixture.sql`update account_age set birth_month = to_char(now() - interval '17 years 1 month', 'YYYY-MM') where user_id = ${seventeen.userId}`;
    await fixture.sql`delete from account_age where user_id = ${missing.userId}`;
    const db = drizzle({ client: fixture.sql });
    const facts = await Promise.all(
      [adult, seventeen, missing].map(({ userId }) =>
        loadAuthorizationAccount(db, userId),
      ),
    );
    assert({
      given:
        'approved accounts born in 2000, born 17 years ago, and with no age record',
      should:
        'report adult, 16-17 and no band, with no birth month in the fact',
      actual: facts.map((fact) => [
        fact?.ageBand,
        Object.keys(fact ?? {}).includes('birthMonth'),
      ]),
      expected: [
        ['adult', false],
        ['16-17', false],
        [null, false],
      ],
    });
  });
});
