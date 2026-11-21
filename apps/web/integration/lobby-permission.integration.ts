import { requireTestServices } from '@daisy/config';
import {
  createLobbyPermissionStore,
  hasGuardianLobbyWaiver,
  readGuardianLobbyIds,
  withRolledBackDatabase,
} from '@daisy/db/testing';
import { mayDebate } from '@daisy/protocol/lobby/eligibility';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { seedGuardianLink } from './guardian-link.test-support';
import { createBots } from './tab-tournament.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('a standing lobby permission stands only on a linked guardian’s signature', async () => {
  await withRolledBackDatabase(databaseUrl, {
    async seed(sql) {
      const [child, guardian, otherAdult] = await createBots(sql, [
        'Child',
        'Guardian',
        'Other adult',
      ]);
      if (!child || !guardian || !otherAdult)
        throw new Error('Missing family fixture');
      await sql`update account_age
        set birth_month=to_char(clock_timestamp() - interval '14 years', 'YYYY-MM'), version=version+1
        where user_id=${child.userId}`;
      await seedGuardianLink(sql, guardian.userId, child.userId);
      await seedGuardianLink(sql, otherAdult.userId, child.userId);
      const [link] = await sql`select id from guardian_links
        where guardian_user_id=${guardian.userId} and minor_user_id=${child.userId}`;
      const [otherLink] = await sql`select id from guardian_links
        where guardian_user_id=${otherAdult.userId} and minor_user_id=${child.userId}`;
      const [adultLobby] =
        await sql`select id, owner_organization_id from lobbies
        where age_rule='adults' and kind='standing' and closed_at is null order by created_at, id limit 1`;
      const [youth] = await sql`select id from lobbies
        where age_rule='under-18' and kind='standing' and closed_at is null order by created_at, id limit 1`;
      if (!link || !otherLink || !adultLobby || !youth)
        throw new Error('Missing lobby fixture');
      const siblingLobby = createId();
      await sql`insert into lobbies (id, kind, owner_organization_id, name, handle, age_rule)
        values (${siblingLobby}, 'standing', ${adultLobby.owner_organization_id}, 'Other Open', ${siblingLobby}, 'adults')`;
      const [currentSeason] =
        await sql`select id from seasons where lobby_id=${adultLobby.id} and status='active'`;
      const seasonId = currentSeason ? String(currentSeason.id) : createId();
      if (!currentSeason)
        await sql`insert into seasons(id,lobby_id,organization_id,name,starts_at,status)
        values (${seasonId},${adultLobby.id},${adultLobby.owner_organization_id},'Open A',now(),'active')`;
      return {
        child,
        guardian,
        otherAdult,
        linkId: String(link.id),
        otherLinkId: String(otherLink.id),
        lobbyId: String(adultLobby.id),
        youthLobby: String(youth.id),
        siblingLobby,
        seasonId,
        organizationId: String(adultLobby.owner_organization_id),
      };
    },
    async work(
      db,
      {
        child,
        guardian,
        otherAdult,
        linkId,
        otherLinkId,
        lobbyId,
        youthLobby,
        siblingLobby,
        seasonId,
        organizationId,
      },
      sql,
    ) {
      const store = createLobbyPermissionStore(db);
      const request = { type: 'request', linkId, lobbyId } as const;
      const signature = {
        type: 'sign',
        linkId,
        lobbyId,
        version: 'fixture-1',
        digest: 'd'.repeat(64),
      } as const;
      const unauthorized = [
        await store.apply(guardian, request),
        await store.apply(guardian, signature),
        await store.apply(child, { ...request, lobbyId: youthLobby }),
      ];
      const requested = await store.apply(child, request);
      const forged = await sql.savepoint(async (direct) => {
        await direct`select set_config('daisy.subject_scope', ${child.userId}, true),
          set_config('daisy.lobby_scope', ${lobbyId}, true)`;
        return direct`update restriction_lobbies
          set signed_at=now(), waiver_version='forged', waiver_digest=repeat('f', 64)
          where guardian_link_id=${linkId} and lobby_id=${lobbyId}
          returning signed_at`;
      });
      const readPermissions = () =>
        db.transaction((tx) => readGuardianLobbyIds(tx, child.userId));
      const hasWaiver = (
        targetLobby: string,
        version: string = signature.version,
      ) =>
        db.transaction((tx) =>
          hasGuardianLobbyWaiver(tx, {
            minorUserId: child.userId,
            lobbyId: targetLobby,
            waiverVersion: version,
          }),
        );
      const pending = await readPermissions();
      unauthorized.push(
        await store.apply(child, signature),
        await store.apply(otherAdult, signature),
        await store.apply(otherAdult, { ...signature, linkId: otherLinkId }),
        await store.apply(guardian, { ...signature, lobbyId: siblingLobby }),
      );
      assert({
        given:
          'refused signatures from the child and the wrong guardians or lobbies',
        should: 'leave both the standing permission and ranked waiver unsigned',
        actual: [await readPermissions(), await hasWaiver(lobbyId)],
        expected: [[], false],
      });
      const approval = await store.apply(guardian, signature);
      const signatureClock = () =>
        sql.savepoint(async (direct) => {
          await direct`select set_config('daisy.subject_scope', ${child.userId}, true)`;
          const [row] = await direct`select waiver.signed_at::text as stamp,
          waiver.signed_at >= permission.signed_at as ordered
          from restriction_lobby_waivers waiver join restriction_lobbies permission
          using (guardian_link_id, lobby_id)
          where waiver.guardian_link_id=${linkId} and waiver.lobby_id=${lobbyId}`;
          return row;
        });
      const firstClock = await signatureClock();
      const retry = await store.apply(guardian, signature);
      assert({
        given: 'a ranked signature and an exact retry',
        should:
          'record the waiver after the standing grant and preserve its timestamp',
        actual: [
          firstClock?.ordered,
          (await signatureClock())?.stamp === firstClock?.stamp,
        ],
        expected: [true, true],
      });
      const guardianLobbyIds = await readPermissions();
      const member = { ageBand: '13-15', guardianLobbyIds } as const;
      const ranked = { ageRule: 'adults', competitionType: 'ranked' } as const;
      assert({
        given:
          'a 14-year-old requests one lobby from one of their two guardians',
        should:
          'require the addressed guardian and keep the sibling lobby closed even in the same league',
        actual: {
          unauthorized,
          requested,
          forged: forged.length,
          pending,
          approval,
          retry,
          guardianLobbyIds,
          mayDebate: [
            mayDebate(member, {
              ...ranked,
              lobbyId: youthLobby,
              ageRule: 'under-18',
            }),
            mayDebate(member, { ...ranked, lobbyId }),
            mayDebate(member, { ...ranked, lobbyId: siblingLobby }),
          ],
          waiver: [await hasWaiver(lobbyId), await hasWaiver(siblingLobby)],
        },
        expected: {
          unauthorized: Array(7).fill(false),
          requested: true,
          forged: 0,
          pending: [],
          approval: true,
          retry: true,
          guardianLobbyIds: [lobbyId],
          mayDebate: [true, true, false],
          waiver: [true, false],
        },
      });
      const nextSeasonId = createId();
      await sql.savepoint(async (fixtures) => {
        await fixtures`set local role none`;
        await fixtures`update seasons set status='closed' where id=${seasonId}`;
        await fixtures`insert into seasons(id,lobby_id,organization_id,name,starts_at,status)
          values (${nextSeasonId},${lobbyId},${organizationId},'Open B',now(),'active')`;
        await fixtures`set local role daisy_web`;
      });
      const beforeRenewal = await hasWaiver(lobbyId);
      const permissionInNewSeason = await readPermissions();
      const renewed = await store.apply(guardian, signature);
      const signedInNewSeason = await hasWaiver(lobbyId);
      const newVersion = {
        ...signature,
        version: 'fixture-2',
        digest: 'e'.repeat(64),
      };
      const beforeNewVersion = await hasWaiver(lobbyId, newVersion.version);
      const signedNewVersion = await store.apply(guardian, newVersion);
      const finalVersion = await hasWaiver(lobbyId, newVersion.version);
      const evidence = await sql.savepoint(async (direct) => {
        await direct`select set_config('daisy.subject_scope', ${child.userId}, true)`;
        return direct`select season_id, waiver_version, waiver_digest from restriction_lobby_waivers
          where guardian_link_id=${linkId} order by season_id = ${nextSeasonId}, waiver_version`;
      });
      assert({
        given: 'the next Open season and a subsequent wording change',
        should:
          'renew each ranked signature while keeping earlier evidence and standing permission',
        actual: {
          beforeRenewal,
          permissionInNewSeason,
          renewed,
          signedInNewSeason,
          beforeNewVersion,
          signedNewVersion,
          finalVersion,
          evidence,
        },
        expected: {
          beforeRenewal: false,
          permissionInNewSeason: [lobbyId],
          renewed: true,
          signedInNewSeason: true,
          beforeNewVersion: false,
          signedNewVersion: true,
          finalVersion: true,
          evidence: [
            {
              season_id: seasonId,
              waiver_version: signature.version,
              waiver_digest: signature.digest,
            },
            {
              season_id: nextSeasonId,
              waiver_version: signature.version,
              waiver_digest: signature.digest,
            },
            {
              season_id: nextSeasonId,
              waiver_version: newVersion.version,
              waiver_digest: newVersion.digest,
            },
          ],
        },
      });
      const ended = await sql.savepoint(async (direct) => {
        await direct`select set_config('daisy.subject_scope', ${guardian.userId}, true)`;
        return direct`update guardian_links
          set status='ended', version=version+1, closed_at=now(), updated_at=now()
          where id=${linkId} returning status`;
      });
      const [retained] = await sql.savepoint(async (direct) => {
        await direct`select set_config('daisy.subject_scope', ${child.userId}, true)`;
        return direct`select waiver_version, waiver_digest from restriction_lobbies
          where guardian_link_id=${linkId} and lobby_id=${lobbyId}`;
      });
      assert({
        given: 'a guardian ending their link after signing',
        should:
          'remove debater eligibility while retaining the signed evidence',
        actual: [
          ended[0]?.status,
          await readPermissions(),
          retained?.waiver_version,
          retained?.waiver_digest,
          await hasWaiver(lobbyId, newVersion.version),
        ],
        expected: ['ended', [], signature.version, signature.digest, false],
      });
    },
  });
});
