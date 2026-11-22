import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { loadFormatCatalogue } from '../src/format-catalogue';
import { createAuthorizationSubject } from './authorization.test-support';
import { createBotActor } from './bot-seat.test-support';
import { withDatabase, withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('Room catalog and unrecorded create read use an admitted current account', async () => {
  await withFixture(url, async (fixture) => {
    const caller = await createAuthorizationSubject(fixture);
    const unlisted = await fixture.format();
    await fixture.preset(unlisted);
    const bot = await createBotActor(fixture);
    const judge = await createBotActor(fixture, 'judge');
    const unconfigured = createId();
    await fixture.insert('actors', { id: unconfigured, kind: 'bot' });
    await withDatabase(url, async (database) => {
      const authorize = (fact: { member: boolean } | null) =>
        fact?.member === true;
      const catalog = await database.listRoomCatalogSources(caller, authorize);
      const bots = await database.listRoomBots(caller, authorize);
      const absent = await database.readRoomCreateReceipt({
        caller,
        commandId: createId(),
        payloadDigest: 'c'.repeat(64),
        authorize,
      });
      const roster = [bot, judge, unconfigured].map((id) => {
        const candidate = bots.find(({ actorId }) => actorId === id);
        return candidate
          ? [
              candidate.label,
              candidate.eligible,
              candidate.aiRole,
              candidate.persona ?? null,
              candidate.difficulty ?? null,
            ]
          : null;
      });
      const freestyle = catalog.find(({ id }) => id === 'freestyle');
      assert({
        given:
          'a real member, a role-bearing and an unlisted format, debater, AI judge and unconfigured actors',
        should:
          'show only catalog presets and eligible setup facts, and return no receipt for a new command',
        actual: [
          freestyle?.role,
          freestyle?.preset.version,
          catalog.some(({ id }) => id === unlisted),
          roster,
          absent,
        ],
        expected: [
          'standard',
          1,
          false,
          [
            ['Fixture bot', true, 'debater', 'Test', 'beginner'],
            ['Fixture judge', true, 'judge', null, null],
            null,
          ],
          null,
        ],
      });
    });
  });
});

test('the Room catalog refuses an inconsistent uncommitted format listing', async () => {
  await withFixture(url, async (fixture) => {
    const incoming = await fixture.format();
    const rollback = new Error('rollback listing');
    await fixture.sql
      .begin(async (client) => {
        await client`update formats set catalog_role='template', family='other' where id=${incoming}`;
        await assertRejects({
          given:
            'a listed format with no current preset visible before the deferred storage guard',
          should: 'refuse with the catalog invariant',
          actual: () => loadFormatCatalogue(drizzle({ client })),
          code: 'INVARIANT',
        });
        throw rollback;
      })
      .catch((error: unknown) => {
        if (error !== rollback) throw error;
      });
  });
});
