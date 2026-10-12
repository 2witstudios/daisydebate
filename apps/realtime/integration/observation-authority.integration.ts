import { SQL } from 'bun';
import { randomBytes, createHash } from 'node:crypto';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { systemId } from '@daisy/clock';
import { createDatabase } from '@daisy/db';
import { createObservationAuthorityDecision } from '@daisy/auth/observation';
import { createObservationAuthorityReader } from '../src/observation-authority';
import { createObservationPermit } from '../src/observation-permit';
import { roundAudienceFixture } from './round-audience.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
test('restricted realtime role composes canonical batch facts and original-start permits', async () => {
  // One administrative fixture connection plus one restricted physical reader;
  // this proves role/composition behavior, not the four-slot capacity profile.
  const admin = new SQL(databaseUrl, { max: 1 });
  const runtime = new SQL(databaseUrl, { max: 1 });
  const database = createDatabase({
    url: databaseUrl,
    client: runtime,
    workloadProfile: 'realtime',
    maxConnections: 4,
  });
  const principal = {
    userId: systemId.next(),
    actorId: systemId.next(),
    sessionId: systemId.next(),
  };
  const rounds = roundAudienceFixture(admin, principal.actorId);
  const resourceIds = [principal.actorId];
  try {
    await admin`insert into users(id,username,email_verified) values(${principal.userId},${principal.userId},true)`;
    await admin`insert into actors(id,kind,user_id) values(${principal.actorId},'human',${principal.userId})`;
    const token = createHash('sha3-256').update(randomBytes(32)).digest('hex');
    await admin`insert into session(id,user_id,token,expires_at) values(${principal.sessionId},${principal.userId},${token},'2099-01-01')`;
    const round = await rounds.seed('private', 'affirmative');
    resourceIds.push(round.id);
    await runtime.unsafe('set role daisy_realtime');
    const [actualRole] = await runtime`select current_user as role`;
    let now = 0;
    const reader = createObservationAuthorityReader({
      now: () => now,
      operations: database.observationAuthority(
        createObservationAuthorityDecision({}),
      ),
    });
    const binding = {
      principal,
      resource: { kind: 'round' as const, id: round.id },
      window: { after: null, limit: 1 },
    };
    const [first] = await reader.admit([binding]);
    const permit = createObservationPermit({
      now: () => now,
      nodeIncarnation: 'node',
    });
    const attempt = permit.begin();
    const admitted =
      first?.status === 'allowed' && permit.install(attempt, first.grant);
    const initiallyAllowed =
      first?.status === 'allowed' &&
      permit.allows(
        first.grant.base,
        first.grant.minimumContentRevision,
        'node',
        first.grant.purgeGeneration,
      );
    await admin`update rounds set resolution='Changed content',version=version+1 where id=${round.id}`;
    now = 3000;
    const [renewed] = await reader.renew([binding]);
    const sameEvidence =
      first?.status === 'allowed' &&
      renewed?.status === 'allowed' &&
      first.grant.cohort.fingerprint === renewed.grant.cohort.fingerprint &&
      JSON.stringify(first.grant.base) === JSON.stringify(renewed.grant.base);
    await admin`delete from round_participants where round_id=${round.id} and actor_id=${principal.actorId}`;
    const [revoked] = await reader.renew([binding]);
    now = 4900;
    const expired =
      first?.status === 'allowed' &&
      permit.allows(
        first.grant.base,
        first.grant.minimumContentRevision,
        'node',
        first.grant.purgeGeneration,
      );
    assert({
      given:
        'real restricted-role current private Round facts, content update, participant removal and original permit expiry',
      should:
        'allow canonical admission, retain semantic evidence through content and deny revoked renewal without extending the old permit',
      actual: {
        role: actualRole?.role,
        admitted,
        initiallyAllowed,
        sameEvidence,
        revoked: revoked?.status,
        expired,
      },
      expected: {
        role: 'daisy_realtime',
        admitted: true,
        initiallyAllowed: true,
        sameEvidence: true,
        revoked: 'denied',
        expired: false,
      },
    });
  } finally {
    await database.close();
    await rounds.close();
    await admin`delete from session where id=${principal.sessionId}`;
    await admin`delete from actors where id=${principal.actorId}`;
    await admin`delete from users where id=${principal.userId}`;
    await admin`delete from resource_observation_headers where resource_id in ${admin(resourceIds)}`;
    await admin.close();
  }
});
