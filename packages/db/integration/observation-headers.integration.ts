import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { readObservationHeaders } from '../src/observation-headers';
import {
  withFixture,
  roundAuthoring,
  createScheduledRound,
  sqlStateOf,
} from './constraint-helpers';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('durable indexed headers progress independently of an assigned-XID blocker and restrict projection writes', async () => {
  await withFixture(url, async (fixture) => {
    const authoring = await roundAuthoring(fixture, url);
    const blocker = new SQL(url, { max: 1 });
    try {
      await createScheduledRound(authoring, 'Header proof');
      const resource = { kind: 'round' as const, id: authoring.roundId };
      const read = () =>
        readObservationHeaders(drizzle({ client: fixture.sql }), [resource]);
      const [initial] = await read();
      await blocker.begin(async (held) => {
        await held`select pg_current_xact_id()`;
        await fixture.sql`update rounds set resolution='Current independent body',version=version+1 where id=${resource.id}`;
        const [next] = await read();
        assert({
          given: 'an unrelated assigned transaction remains uncommitted',
          should:
            'advance current resource metadata without a finalized outbox cursor',
          actual: {
            newer: next!.contentRevision > initial!.contentRevision,
            disclosureStable:
              next!.disclosureRevision === initial!.disclosureRevision,
          },
          expected: { newer: true, disclosureStable: true },
        });
      });
      await fixture.sql.begin(async (role) => {
        await role`set local role daisy_projection`;
        const headers = await readObservationHeaders(
          drizzle({ client: role }),
          [resource],
        );
        assert({
          given: 'the projection role',
          should:
            'read only current metadata through the indexed bounded provider',
          actual: headers.length,
          expected: 1,
        });
      });
      const denied = await fixture.sql.begin(async (role) => {
        await role`set local role daisy_projection`;
        return sqlStateOf(
          () =>
            role`update resource_observation_headers set content_revision=1 where resource_id=${resource.id}`,
        );
      });
      assert({
        given: 'direct DML with the actual projection role',
        should: 'refuse metadata mutation',
        actual: denied,
        expected: '42501',
      });
      const [{ version }] =
        await fixture.sql`select version from rounds where id=${resource.id}`;
      const [before] = await read();
      await fixture.sql`update resource_observation_headers set content_revision=9007199254740991 where resource_id=${resource.id}`;
      const failed = await sqlStateOf(
        () =>
          fixture.sql`update rounds set resolution='Must roll back',version=version+1 where id=${resource.id}`,
      );
      const [after] =
        await fixture.sql`select version,resolution from rounds where id=${resource.id}`;
      assert({
        given: 'forced durable header overflow',
        should: 'roll back the owning resource mutation atomically',
        actual: {
          failed,
          version: after!.version,
          resolution: after!.resolution,
        },
        expected: {
          failed: '23514',
          version,
          resolution: 'Current independent body',
        },
      });
      await fixture.sql`update resource_observation_headers set content_revision=${before!.contentRevision} where resource_id=${resource.id}`;
    } finally {
      await authoring.database.close();
      await blocker.close();
    }
  });
});

test('opposite multi-channel inbox dirt coalesces content and flushes the complete key union without authority churn', async () => {
  const { createAuthorizationSubject } =
    await import('./authorization.test-support');
  const { createId } = await import('@paralleldrive/cuid2');
  await withFixture(url, async (fixture) => {
    const actors = [
      await createAuthorizationSubject(fixture),
      await createAuthorizationSubject(fixture),
    ];
    const channels = [createId(), createId()];
    const clients = [new SQL(url, { max: 1 }), new SQL(url, { max: 1 })];
    try {
      for (const id of channels) {
        await fixture.insert('messaging_channels', {
          id,
          kind: 'private_group',
          policy_key: 'social.private_group',
          policy_revision: 1,
          lifecycle: 'active',
        });
        for (const actor of actors)
          await fixture.sql`insert into messaging_actor_states(channel_id,actor_id,following,hidden,notification_level) values(${id},${actor.actorId},true,false,'all')`;
      }
      const resources = actors.map((actor) => ({
        kind: 'inbox' as const,
        id: actor.actorId,
      }));
      const before = await readObservationHeaders(
        drizzle({ client: fixture.sql }),
        resources,
      );
      let release!: () => void;
      const barrier = new Promise<void>((done) => (release = done));
      const ready: Promise<void>[] = [];
      const writes = clients.map((client, index) => {
        let arrive!: () => void;
        ready.push(new Promise<void>((done) => (arrive = done)));
        return client.begin(async (tx) => {
          for (const actor of index === 0 ? actors : [...actors].reverse())
            await tx`update messaging_actor_states set read_sequence=read_sequence+1 where channel_id=${channels[index]!} and actor_id=${actor.actorId}`;
          arrive();
          await barrier;
        });
      });
      await Promise.all(
        ready.map((arrived, index) => Promise.race([arrived, writes[index]!])),
      );
      const whileOpen = await readObservationHeaders(
        drizzle({ client: fixture.sql }),
        resources,
      );
      release();
      await Promise.all(writes);
      const after = await readObservationHeaders(
        drizzle({ client: fixture.sql }),
        resources,
      );
      const [{ pending }] =
        await fixture.sql`select count(*)::int pending from resource_observation_pending`;
      assert({
        given:
          'two transactions accumulate overlapping header keys in opposite row-trigger order',
        should:
          'publish only after commit, advance each content revision once per transaction, preserve disclosure and remove dirt',
        actual: {
          whileOpen: whileOpen.map((h) => h.contentRevision),
          content: after.map((h) => h.contentRevision),
          disclosure: after.map((h) => h.disclosureRevision),
          pending,
        },
        expected: {
          whileOpen: before.map((h) => h.contentRevision),
          content: before.map((h) => h.contentRevision + 2),
          disclosure: before.map((h) => h.disclosureRevision),
          pending: 0,
        },
      });
    } finally {
      await Promise.allSettled(
        clients.map((client) => client.close({ timeout: 1 })),
      );
      for (const id of channels)
        await fixture.sql`delete from messaging_channels where id=${id}`;
    }
  });
});
