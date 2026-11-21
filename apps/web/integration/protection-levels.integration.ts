import { expect, test } from 'bun:test';
import { requireTestServices } from '@daisy/config';
import { createGuardianStore, withRolledBackDatabase } from '@daisy/db/testing';
import type { GuardianCommand } from '@daisy/protocol/guardians';
import { runGuardianCommand } from '../src/features/parental-controls/commands';
import { createBots } from './tab-tournament.test-support';

const { databaseUrl } = requireTestServices(process.env);

test('two guardians share one choice, and only the last link closing removes it', async () => {
  const at = new Date();
  const birth = `${at.getUTCFullYear() - 15}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
  await withRolledBackDatabase(databaseUrl, {
    seed: async (sql) => {
      const [parent, child, coGuardian, stranger] = await createBots(sql, [
        'Parent',
        'Child',
        'Co-guardian',
        'Stranger',
      ]);
      if (!parent || !child || !coGuardian || !stranger)
        throw new Error('Missing family fixture');
      for (const person of [parent, child, coGuardian, stranger])
        await sql`update users set email=${`${person.userId}@example.test`} where id=${person.userId}`;
      await sql`update account_age set birth_month=${birth}, version=version+1 where user_id=${child.userId}`;
      return { parent, child, coGuardian, stranger };
    },
    work: async (db, { parent, child, coGuardian, stranger }, sql) => {
      const store = createGuardianStore(db);
      const run = (caller: typeof parent, command: GuardianCommand) =>
        store.forSubject(caller.userId, (session) =>
          runGuardianCommand(
            { session, caller, at: at.toISOString() },
            command,
          ),
        );
      const linkIdFor = async (guardian: typeof parent) => {
        expect(
          await run(guardian, {
            version: 1,
            type: 'request-link',
            username: `bot-${child.userId}`,
            noticeVersion: 'draft-1',
          }),
        ).toMatchObject({ kind: 'accepted' });
        const row = await store.forSubject(guardian.userId, (session) =>
          session.openLink(child.userId),
        );
        if (!row) throw new Error('Link missing');
        return row.id;
      };
      const confirm = (linkId: string) =>
        run(child, {
          version: 1,
          type: 'confirm-parent',
          linkId,
          noticeVersion: 'draft-1',
        });
      const read = () =>
        store.forSubject(child.userId, (session) =>
          session.protectionLevel(child.userId),
        );
      const direct = async (userId: string) => {
        return sql.savepoint(async (scoped) => {
          await scoped`select set_config('daisy.subject_scope', ${userId}, true)`;
          return scoped`select choice from protection_levels where user_id=${child.userId}`;
        });
      };
      const first = await linkIdFor(parent);
      const second = await linkIdFor(coGuardian);
      const supervised = {
        version: 1,
        type: 'set-protection-level',
        linkId: first,
        choice: { level: 'supervised' },
      } as const;
      expect(await read()).toEqual({ level: 'independent' });
      expect(await run(parent, supervised)).toEqual({
        kind: 'refused',
        refusal: 'not-active',
      });
      expect(await run(stranger, supervised)).toEqual({
        kind: 'refused',
        refusal: 'not-found',
      });
      expect(await confirm(first)).toEqual({ kind: 'accepted' });
      expect(await confirm(second)).toEqual({ kind: 'accepted' });
      expect(await read()).toEqual({ level: 'guided' });
      expect(await run(parent, supervised)).toEqual({ kind: 'accepted' });
      expect(await direct(child.userId)).toEqual([
        { choice: { level: 'supervised' } },
      ]);
      expect(await direct(stranger.userId)).toEqual([]);
      const custom = {
        level: 'custom',
        friendApproval: 'all',
        friendsOnlyMessages: false,
        rankedAllowed: true,
      } as const;
      expect(
        await run(coGuardian, {
          ...supervised,
          linkId: second,
          choice: custom,
        }),
      ).toEqual({ kind: 'accepted' });
      expect(await direct(child.userId)).toEqual([{ choice: custom }]);
      const end = { version: 1, type: 'end-link', linkId: first } as const;
      expect(await run(parent, end)).toEqual({ kind: 'accepted' });
      expect(await read()).toEqual(custom);
      expect(await run(coGuardian, { ...end, linkId: second })).toMatchObject({
        kind: 'accepted',
      });
      expect(await read()).toEqual({ level: 'independent' });
      expect(await direct(child.userId)).toEqual([]);
    },
  });
});
