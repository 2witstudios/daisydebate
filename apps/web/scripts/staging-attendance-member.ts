import { SQL } from 'bun';
import { systemId } from '@daisy/clock';
import { createDatabase } from '@daisy/db';
import { decideBetaAccessChange } from '@daisy/auth';

/** Owner-authorized staging-only synthetic identity, following the existing transcript fixture conventions. */
export async function createStagingAttendanceMember(input: {
  sql: SQL;
  url: string;
  secret: string;
}) {
  const nextId = () => systemId.next();
  const userId = nextId();
  const database = createDatabase({ url: input.url, nextActorId: nextId });
  try {
    await input.sql`insert into users (id,email,email_verified) values (${userId},${`attendance-${userId}@example.test`},true)`;
    await database.recordAgeStep({
      userId,
      birthMonth: '1990-01',
      termsVersion: 'draft-0',
      now: new Date().toISOString(),
    });
    const claim = await database.claimUsername({
      userId,
      username: `probe-${userId.slice(0, 16)}`,
    });
    if (claim.kind !== 'claimed')
      throw new Error('Synthetic attendance username refused');
    const [account] =
      await input.sql`select a.id as actor_id,b.revision,b.state from actors a join account_beta_access b on b.user_id=a.user_id where a.user_id=${userId}`;
    if (!account || account.state !== 'pending')
      throw new Error('Fresh synthetic admission state mismatch');
    const commandId = nextId();
    const digest = new Bun.CryptoHasher('sha3-256')
      .update(
        JSON.stringify({
          commandId,
          userId,
          purpose: 'PROBE-3 owner-authorized staging repair',
        }),
      )
      .digest('hex');
    await database.runBetaAccessCommand({
      commandId,
      serviceId: 'staging-attendance-probe',
      operatorRef: nextId(),
      targetUserId: userId,
      desired: 'approved',
      expectedRevision: account.revision,
      requestDigest: digest,
      adminAuditHead: digest,
      nextId,
      live: () => true,
      authorize: (target) =>
        target?.userId === userId &&
        target.actorId === account.actor_id &&
        !target.erased,
      decide: (current, ageBand) =>
        decideBetaAccessChange({
          current,
          desired: 'approved',
          expectedRevision: account.revision,
          ageAdmitted: ageBand === 'adult' || ageBand === '16-17',
        }),
    });
    const sessionId = nextId();
    const token = Buffer.from(
      crypto.getRandomValues(new Uint8Array(32)),
    ).toString('base64url');
    await input.sql`insert into session (id,user_id,token,expires_at) values (${sessionId},${userId},${token},now()+interval '7 days')`;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(input.secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signature = Buffer.from(
      await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token)),
    ).toString('base64');
    return {
      userId,
      sessionId,
      cookie: `__Secure-better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`,
    };
  } finally {
    await database.close();
  }
}
