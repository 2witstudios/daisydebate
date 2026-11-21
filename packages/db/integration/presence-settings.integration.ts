import { requireTestServices } from '@daisy/config';
import { createAppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { presencePrivacyAdopter } from '../src/presence/privacy';
import { readChosenStatus, writeChosenStatus } from '../src/presence/settings';
import { openPairStore } from './contact-pair-store.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('presence settings are fenced, scoped and adopted by privacy', async () => {
  const { client, fixture } = await openPairStore(databaseUrl);
  const { actorId, userId, otherActorId, otherUserId, now } = fixture;
  const statements: string[] = [];
  const database = drizzle({
    client,
    logger: { logQuery: (query) => statements.push(query) },
  });
  const me = { actorId: actorId!, userId: userId! };
  const peer = { actorId: otherActorId!, userId: otherUserId! };
  const allow = async () => {};
  try {
    const initial = await readChosenStatus(database, me, allow);
    await writeChosenStatus(
      database,
      me,
      { status: 'appearing_offline', now },
      allow,
    );
    await writeChosenStatus(database, peer, { status: 'busy', now }, allow);
    statements.length = 0;
    for (const attempt of [
      () =>
        readChosenStatus(database, me, async () => {
          throw createAppError('AUTHORIZATION');
        }),
      () =>
        writeChosenStatus(database, me, { status: 'online', now }, async () => {
          throw createAppError('AUTHORIZATION');
        }),
    ])
      await assertRejects({
        given: 'a refusing account fence',
        should: 'refuse the choice operation',
        actual: attempt,
        code: 'AUTHORIZATION',
      });
    assert({
      given: 'the refused choice operations',
      should: 'never query the choice table',
      actual: statements.some((query) => query.includes('presence_settings')),
      expected: false,
    });
    statements.length = 0;
    await assertRejects({
      given: 'a malformed actor',
      should: 'refuse a choice before SQL',
      actual: () =>
        writeChosenStatus(
          database,
          { ...me, actorId: 'x' },
          { status: 'online', now },
          allow,
        ),
      code: 'VALIDATION',
    });
    assert({
      given: 'the malformed write',
      should: 'issue no SQL',
      actual: statements,
      expected: [],
    });
    const exported = await presencePrivacyAdopter.export(database, me);
    await presencePrivacyAdopter.erase(database, me, { now });
    assert({
      given:
        'two members with different stored choices and one subject erasure',
      should:
        'default an unset choice to online, export the subject’s own timestamped choice, and erase only that choice',
      actual: [
        initial,
        presencePrivacyAdopter.phase,
        exported,
        await readChosenStatus(database, me, allow),
        await readChosenStatus(database, peer, allow),
      ],
      expected: [
        'online',
        'after-close',
        {
          presence_settings: [
            {
              actor_id: actorId,
              chosen_status: 'appearing_offline',
              updated_at: now,
            },
          ],
        },
        'online',
        'busy',
      ],
    });
  } finally {
    await client`delete from presence_settings where actor_id in (${actorId!}, ${otherActorId!})`;
    await fixture.cleanup();
    await client.close();
  }
});
