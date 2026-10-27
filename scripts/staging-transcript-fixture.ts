import { SQL } from 'bun';
import { systemId } from '@daisy/clock';
import { createDatabase } from '@daisy/db';
import { decideBetaAccessChange } from '@daisy/auth';

const email = 'transcript-proof@example.test';
const username = 'staging-transcript-proof';
const createId = () => systemId.next();

/** Called only after origin, Fly app, release SHA and actual database guards. */
export async function transcriptProofFixture(
  sql: SQL,
  url: string,
  secret: string,
) {
  const database = createDatabase({
    url,
    nextActorId: createId,
    maxConnections: 1,
  });
  try {
    await sql`insert into users (id,email,email_verified) values (${createId()},${email},true) on conflict (email) do nothing`;
    const [user] =
      await sql`select id,username,deleted_at from users where email=${email}`;
    if (
      !user ||
      user.deleted_at ||
      (user.username && user.username !== username)
    )
      throw new Error('Synthetic transcript account identity mismatch');
    const claim = await database.claimUsername({ userId: user.id, username });
    if (!['claimed', 'unchanged'].includes(claim.kind))
      throw new Error('Synthetic transcript username refused');
    await database.recordAgeStep({
      userId: user.id,
      birthMonth: '1990-01',
      termsVersion: 'draft-0',
      now: new Date().toISOString(),
    });
    const [account] =
      await sql`select a.id as actor_id,b.revision,b.state from actors a join account_beta_access b on b.user_id=a.user_id where a.user_id=${user.id}`;
    if (!account || account.state === 'revoked')
      throw new Error('Synthetic transcript access refused');
    if (account.state === 'pending') {
      const commandId = createId();
      const digest = new Bun.CryptoHasher('sha3-256')
        .update(
          JSON.stringify({
            commandId,
            userId: user.id,
            purpose: 'ISSUE-478 staging fixture; pu channel 579',
          }),
        )
        .digest('hex');
      await database.runBetaAccessCommand({
        commandId,
        serviceId: 'staging-transcript-proof',
        operatorRef: createId(),
        targetUserId: user.id,
        desired: 'approved',
        expectedRevision: account.revision,
        requestDigest: digest,
        adminAuditHead: digest,
        nextId: createId,
        authorize: (target) =>
          target?.userId === user.id &&
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
    }
    // ISSUE-646: an approved beta host has the flat monthly cap; nothing is granted or reset.
    const sessionId = createId();
    const token = Buffer.from(
      crypto.getRandomValues(new Uint8Array(32)),
    ).toString('base64url');
    await sql`insert into session (id,user_id,token,expires_at) values (${sessionId},${user.id},${token},now()+interval '15 minutes')`;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signature = Buffer.from(
      await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token)),
    ).toString('base64');
    return {
      // Better Call 1.4.0's installed signed-cookie wire format. No cookie cache.
      cookie: `__Secure-better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`,
      close: async () => {
        await sql`delete from session where id=${sessionId} and user_id=${user.id}`;
      },
    };
  } finally {
    await database.close();
  }
}
