import { afterAll, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { requireTestServices } from '@daisy/config';
import { errorCodeOf } from '@daisy/errors';
import { mediaReleaseWording } from '@daisy/protocol/media-release';
import { createId } from '@paralleldrive/cuid2';
import { sql as statement } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import type { BoundedTransaction } from '../src/bounded-transaction';
import { createMediaReleases } from '../src/media-releases';
import {
  erasePrivacySubject,
  subjectRightsVerificationBindings,
} from '../src/privacy';
import { Fixture } from './constraint-helpers';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';

const { databaseUrl } = requireTestServices(process.env);
const scratch = scratchDatabase(databaseUrl, 'guardianclosure');
afterAll(() => scratch.drop());

test(
  'an active guardian signs and closes only their linked child through subject rights',
  async () => {
    await scratch.create();
    await scratch.migrate(() => true);
    const sql = new SQL(scratch.url);
    try {
      const fixture = new Fixture(sql);
      const user = async (years: string) => {
        const userId = await fixture.user();
        const actorId = await fixture.actor(userId);
        const email = `${userId}@guardian.invalid`;
        await sql`update users set email = ${email}, email_verified = true where id = ${userId}`;
        await sql`insert into account_age(user_id, birth_month, version, recorded_at)
        values (${userId}, to_char(now() - ${years}::interval, 'YYYY-MM'), 1, clock_timestamp())`;
        return { userId, actorId, email };
      };
      const guardian = await user('40 years');
      const child = await user('15 years');
      const other = await user('40 years');
      const now = new Date().toISOString();
      const evidence = createId();
      await fixture.insert('guardian_consent_evidence', {
        id: evidence,
        person_user_id: guardian.userId,
        role: 'guardian',
        method: 'created-account',
        notice_kind: 'parental-consent',
        notice_version: 'fixture',
        notice_digest: 'a'.repeat(64),
        recorded_at: now,
      });
      const linkId = createId();
      await fixture.insert('guardian_links', {
        id: linkId,
        guardian_user_id: guardian.userId,
        minor_user_id: child.userId,
        guardian_consent_id: evidence,
        status: 'requested',
        created_at: now,
      });
      const round = await fixture.round({ created_by_actor_id: child.actorId });
      await sql`insert into session(id, token, user_id, expires_at)
      values (${createId()}, ${createId()}, ${child.userId}, now() + interval '1 day')`;
      const db = drizzle({ client: sql });
      const transaction = <T>(work: Parameters<BoundedTransaction>[0]) =>
        db.transaction(async (tx) => {
          await tx.execute(statement`set local role daisy_web`);
          return work(tx, new AbortController().signal, {
            receivedAt: now,
            writer: { pid: 0, backendStart: now },
          }) as Promise<T>;
        });
      const releases = createMediaReleases({
        run: transaction,
        nextId: createId,
      });
      const authority = { guardian, linkId };
      const sign = (caller: typeof authority) =>
        releases.signAsGuardian(
          caller,
          {
            wordingVersion: mediaReleaseWording.version,
            name: 'Taylor Guardian',
            relation: 'parent',
            attests: true,
            paidAds: false,
          },
          () => 'a'.repeat(64),
        );
      const close = (caller: typeof authority) =>
        erasePrivacySubject(
          { transaction },
          {
            ...caller,
            now: new Date().toISOString(),
            vendors: ['stripe'],
            jobIds: [createId()],
          },
          {
            closeRoom: <T>(room: T) => room,
            eraseSeats: <T>(room: T) => room,
            activeRoomMembers: () => [],
          },
          subjectRightsVerificationBindings,
        );
      const outcome = (operation: Promise<unknown>) =>
        operation.then(
          () => 'accepted',
          (failure: unknown) => errorCodeOf(failure, 'INTERNAL'),
        );

      expect(await outcome(sign(authority))).toBe('NOT_FOUND');
      expect(await outcome(close(authority))).toBe('NOT_FOUND');
      await sql`update guardian_links set status = 'active', activation = 'created-account',
      activated_at = ${now} where id = ${linkId}`;
      const foreign = { guardian: other, linkId };
      expect(await outcome(sign(foreign))).toBe('NOT_FOUND');
      expect(await outcome(close(foreign))).toBe('NOT_FOUND');
      const signed = await sign(authority);
      expect(signed.kind).toBe('done');
      expect(await sign(authority)).toEqual({
        kind: 'refused',
        reason: 'already_released',
      });
      expect(
        await sql`select scope, signer_email, wording_version from media_releases
      where user_id = ${child.userId} and withdrawn_at is null`,
      ).toEqual([
        {
          scope: 'publish',
          signer_email: guardian.email,
          wording_version: mediaReleaseWording.version,
        },
      ]);
      expect(
        await sql`select m.kind from media_release_mails m
      join media_release_requests r on r.id = m.request_id
      where r.user_id = ${child.userId}`,
      ).toEqual([{ kind: 'copy' }]);

      expect((await close(authority)).alreadyErased).toBe(false);
      expect(
        await sql`select username, email, deleted_at is not null as closed from users
      where id = ${child.userId}`,
      ).toEqual([{ username: `u-${child.userId}`, email: null, closed: true }]);
      expect(
        await sql`select id from actors where user_id = ${child.userId}`,
      ).toEqual([{ id: child.actorId }]);
      expect(await sql`select id from rounds where id = ${round}`).toEqual([
        { id: round },
      ]);
      expect(
        await sql`select id from session where user_id = ${child.userId}`,
      ).toEqual([]);
      expect(
        await sql`select status from guardian_links where id = ${linkId}`,
      ).toEqual([{ status: 'ended' }]);
      expect(
        await sql`select id from guardian_consent_evidence where id = ${evidence}`,
      ).toEqual([{ id: evidence }]);
      expect(
        await sql`select withdrawn_by from media_releases where user_id = ${child.userId}`,
      ).toEqual([{ withdrawn_by: 'erasure' }]);
      expect(
        await sql`select vendor, status from privacy_jobs where subject_ref = ${child.userId}`,
      ).toEqual([{ vendor: 'stripe', status: 'pending' }]);
      expect(
        await sql`select email, deleted_at from users where id = ${guardian.userId}`,
      ).toEqual([{ email: guardian.email, deleted_at: null }]);
    } finally {
      await sql.close();
    }
  },
  ddlTimeoutMs,
);
